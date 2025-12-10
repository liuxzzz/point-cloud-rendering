import type { LassoPoint, PointCloudData } from "./types"

type Viewport = { width: number; height: number }

type WorkerRequestType = "init" | "select" | "color"

type SelectionPayload = {
  path: LassoPoint[]
  viewProjectionMatrix: Float32Array
  viewport: Viewport
  startIndex?: number
  endIndex?: number
}

type WorkerSuccessResponse =
  | { type: "init"; result: { count: number } }
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
