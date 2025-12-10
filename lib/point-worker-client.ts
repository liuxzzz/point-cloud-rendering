import type { LassoPoint, PointCloudData } from "./types"

type Viewport = { width: number; height: number }

type WorkerRequestType = "init" | "select" | "color"

type SelectionPayload = {
  path: LassoPoint[]
  viewProjectionMatrix: Float32Array
  viewport: Viewport
}

type ColorPayload = {
  indices: Uint32Array
  color: [number, number, number]
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

export class PointWorkerClient {
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
      // 将所有 pending 的请求置为失败
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

  async init(data: PointCloudData) {
    const response = await this.call("init", data)
    if (response.type !== "init") throw new Error("Unexpected init response")
    return response.result
  }

  async select(payload: SelectionPayload) {
    const response = await this.call("select", payload)
    if (response.type !== "select") throw new Error("Unexpected select response")
    return response.result
  }

  async color(payload: ColorPayload) {
    const response = await this.call("color", payload, [payload.indices.buffer])
    if (response.type !== "color") throw new Error("Unexpected color response")
    return {
      coloringTime: response.result.coloringTime,
      colors: new Float32Array(response.result.colors),
    }
  }

  private call(type: WorkerRequestType, payload: unknown, transferables: Transferable[] = []) {
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
