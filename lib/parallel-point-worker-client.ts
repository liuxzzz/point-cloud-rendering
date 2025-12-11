import type { LassoPoint, PointCloudData } from "./types"

type Viewport = { width: number; height: number }

type WorkerRequestType = "init" | "parse" | "select" | "color"

type SelectionPayload = {
  path: LassoPoint[]
  viewProjectionMatrix: Float32Array
  viewport: Viewport
  startIndex?: number
  endIndex?: number
}

type WorkerSuccessResponse =
  | { type: "init"; result: { count: number } }
  | { type: "parse"; result: { data: PointCloudData } }
  | { type: "select"; result: { indices: Uint32Array; searchTime: number } }
  | { type: "color"; result: { colors: ArrayBuffer; coloringTime: number } }

type WorkerResponse = {
  id: number
  success: boolean
  message?: string
  data?: WorkerSuccessResponse
}

type PendingResolver = {
  resolve: (value: WorkerSuccessResponse) => void
  reject: (reason?: unknown) => void
}

/**
 * 单个 Worker 实例的封装
 */
class SingleWorker {
  private worker: Worker
  private requestId = 0
  private pending = new Map<number, PendingResolver>()

  constructor() {
    this.worker = new Worker(new URL("./workers/point-worker.ts", import.meta.url), { type: "module" })
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { id, success, message, data } = event.data
      const pending = this.pending.get(id)
      if (!pending) return
      this.pending.delete(id)

      if (!success || !data) {
        pending.reject(new Error(message ?? "Worker failure"))
        return
      }

      pending.resolve(data)
    }

    this.worker.onerror = (error) => {
      const err = error instanceof Error ? error : new Error("Worker crashed")
      for (const [, resolver] of this.pending) {
        resolver.reject(err)
      }
      this.pending.clear()
    }
  }

  terminate() {
    this.worker.terminate()
    this.pending.clear()
  }

  call(type: WorkerRequestType, payload: unknown, transferables: Transferable[] = []) {
    const id = ++this.requestId

    return new Promise<WorkerSuccessResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      if (transferables.length > 0) {
        this.worker.postMessage({ id, type, payload }, transferables)
      } else {
        this.worker.postMessage({ id, type, payload })
      }
    })
  }
}

/**
 * 并行 Worker 池客户端
 * 使用多个 Worker 并行处理套索选择，提升大数据量下的性能
 */
export class ParallelPointWorkerClient {
  private workers: SingleWorker[] = []
  private workerCount: number
  private pointCount = 0

  constructor(workerCount?: number) {
    // 默认使用 CPU 核心数，但最少 2 个，最多 12 个
    this.workerCount = workerCount ?? Math.min(Math.max(navigator.hardwareConcurrency || 4, 2), 12)
    
    for (let i = 0; i < this.workerCount; i++) {
      this.workers.push(new SingleWorker())
    }
  }

  terminate() {
    for (const worker of this.workers) {
      worker.terminate()
    }
    this.workers = []
  }

  /**
   * 解析 PCD 文件（在单个 Worker 中执行）
   * 由于解析本身已经是密集计算，使用单个 Worker 避免重复解析
   */
  async parse(arrayBuffer: ArrayBuffer): Promise<PointCloudData> {
    // 只使用第一个 Worker 进行解析
    const result = await this.workers[0].call("parse", { arrayBuffer }, [arrayBuffer])
    
    if (result.type !== "parse") {
      throw new Error("Unexpected response type")
    }

    const data = result.result.data
    this.pointCount = data.count

    // 🔧 关键修复：解析完成后，同步数据到所有 Worker（包括第一个）
    // 因为第一个 Worker 在 parse 时使用了 transfer，其内部数据已失效
    // 必须重新 init 以确保所有 Worker 都有完整的数据副本
    const syncPromises = this.workers.map((worker) => worker.call("init", data))
    await Promise.all(syncPromises)

    return data
  }

  /**
   * 初始化所有 Worker，将点云数据同步到每个 Worker
   */
  async init(data: PointCloudData) {
    this.pointCount = data.count

    // 并行初始化所有 Worker
    const promises = this.workers.map((worker) => worker.call("init", data))
    await Promise.all(promises)

    return { count: this.pointCount }
  }

  /**
   * 并行执行套索选择
   * 将点云分片，每个 Worker 处理一部分，最后合并结果
   */
  async select(payload: {
    path: LassoPoint[]
    viewProjectionMatrix: Float32Array
    viewport: Viewport
  }): Promise<{ indices: Uint32Array; searchTime: number }> {
    const start = performance.now()

    // 计算每个 Worker 处理的点数
    const chunkSize = Math.ceil(this.pointCount / this.workerCount)

    // 并行发送选择任务
    const promises = this.workers.map((worker, index) => {
      const startIndex = index * chunkSize
      const endIndex = Math.min(startIndex + chunkSize, this.pointCount)

      // 如果这个分片没有点，跳过
      if (startIndex >= this.pointCount) {
        return Promise.resolve({
          type: "select" as const,
          result: { indices: new Uint32Array(), searchTime: 0 },
        })
      }

      return worker.call("select", {
        ...payload,
        startIndex,
        endIndex,
      })
    })

    // 等待所有 Worker 完成
    const results = await Promise.all(promises)

    // 合并所有结果
    let totalCount = 0
    const partialResults: Uint32Array[] = []

    for (const result of results) {
      if (result.type === "select") {
        const indices = result.result.indices
        if (indices.length > 0) {
          partialResults.push(indices)
          totalCount += indices.length
        }
      }
    }

    // 合并到单个数组
    const mergedIndices = new Uint32Array(totalCount)
    let offset = 0
    for (const partial of partialResults) {
      mergedIndices.set(partial, offset)
      offset += partial.length
    }

    const searchTime = performance.now() - start

    return { indices: mergedIndices, searchTime }
  }

  /**
   * 获取 Worker 数量（用于调试/显示）
   */
  getWorkerCount() {
    return this.workerCount
  }
}
