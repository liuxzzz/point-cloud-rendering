/// <reference lib="webworker" />

import type { LassoPoint, PointCloudData } from "../types"

type Viewport = { width: number; height: number }

type InitMessage = {
  type: "init"
  payload: PointCloudData
}

type SelectMessage = {
  type: "select"
  payload: {
    path: LassoPoint[]
    viewProjectionMatrix: Float32Array
    viewport: Viewport
  }
}

type ColorMessage = {
  type: "color"
  payload: {
    indices: Uint32Array
    color: [number, number, number]
  }
}

type WorkerMessage = {
  id: number
} & (InitMessage | SelectMessage | ColorMessage)

type SuccessResponse =
  | {
      type: "init"
      result: { count: number }
    }
  | {
      type: "select"
      result: { indices: Uint32Array; searchTime: number }
    }
  | {
      type: "color"
      result: { colors: ArrayBuffer; coloringTime: number }
    }

interface WorkerResponse {
  id: number
  success: boolean
  message?: string
  data?: SuccessResponse
  transfer?: Transferable[]
}

let positions: Float32Array | null = null
let colors: Float32Array | null = null
let pointCount = 0

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { id, type, payload } = event.data

  try {
    let response: WorkerResponse

    switch (type) {
      case "init": {
        const data = payload as PointCloudData
        positions = data.positions
        colors = data.colors
        pointCount = data.count

        response = { id, success: true, data: { type: "init", result: { count: pointCount } } }
        break
      }
      case "select": {
        const result = handleSelect(payload as SelectMessage["payload"])
        response = {
          id,
          success: true,
          data: { type: "select", result },
          transfer: [result.indices.buffer],
        }
        break
      }
      case "color": {
        const result = handleColor(payload as ColorMessage["payload"])
        response = {
          id,
          success: true,
          data: { type: "color", result },
          transfer: [result.colors],
        }
        break
      }
      default:
        throw new Error(`Unsupported message type: ${String(type)}`)
    }

    if (response.transfer?.length) {
      ctx.postMessage(response, response.transfer)
    } else {
      ctx.postMessage(response)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker error"
    ctx.postMessage({ id, success: false, message })
  }
}

function handleSelect({
  path,
  viewProjectionMatrix,
  viewport,
}: SelectMessage["payload"]): { indices: Uint32Array; searchTime: number } {
  if (!positions) {
    throw new Error("Point data is not initialized")
  }

  const start = performance.now()

  // 快速返回
  if (path.length < 3 || viewport.width === 0 || viewport.height === 0 || viewProjectionMatrix.length !== 16) {
    return { indices: new Uint32Array(), searchTime: performance.now() - start }
  }

  // 预处理套索路径：拆分为两个连续数组，减少属性访问
  const pathLength = path.length
  const pathXs = new Float32Array(pathLength)
  const pathYs = new Float32Array(pathLength)
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (let i = 0; i < pathLength; i++) {
    const p = path[i]
    const x = p.x
    const y = p.y
    pathXs[i] = x
    pathYs[i] = y
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  const selected: number[] = []
  const e = viewProjectionMatrix
  const width = viewport.width
  const height = viewport.height

  // 预取矩阵元素（列主序）
  const m00 = e[0],
    m01 = e[1],
    m02 = e[2],
    m03 = e[3]
  const m10 = e[4],
    m11 = e[5],
    m12 = e[6],
    m13 = e[7]
  const m20 = e[8],
    m21 = e[9],
    m22 = e[10],
    m23 = e[11]
  const m30 = e[12],
    m31 = e[13],
    m32 = e[14],
    m33 = e[15]

  for (let i = 0; i < pointCount; i++) {
    const idx = i * 3
    const x = positions[idx]
    const y = positions[idx + 1]
    const z = positions[idx + 2]

    // 变换到裁剪空间
    const clipX = m00 * x + m10 * y + m20 * z + m30
    const clipY = m01 * x + m11 * y + m21 * z + m31
    const clipZ = m02 * x + m12 * y + m22 * z + m32
    const clipW = m03 * x + m13 * y + m23 * z + m33

    if (clipW === 0) continue

    const invW = 1 / clipW
    const ndcX = clipX * invW
    const ndcY = clipY * invW
    const ndcZ = clipZ * invW

    // 仅保留视锥内点
    if (ndcZ >= 1) continue

    const screenX = (ndcX + 1) * 0.5 * width
    const screenY = (-ndcY + 1) * 0.5 * height

    // 边界框快速剔除
    if (screenX < minX || screenX > maxX || screenY < minY || screenY > maxY) continue

    if (isPointInPolygon(screenX, screenY, pathXs, pathYs)) {
      selected.push(i)
    }
  }

  const indices = new Uint32Array(selected)
  const searchTime = performance.now() - start
  return { indices, searchTime }
}

function handleColor({ indices, color }: ColorMessage["payload"]): { colors: ArrayBuffer; coloringTime: number } {
  if (!colors) {
    throw new Error("Color buffer is not initialized")
  }

  const [r, g, b] = color
  const start = performance.now()

  for (let i = 0; i < indices.length; i++) {
    const base = indices[i] * 3
    colors[base] = r
    colors[base + 1] = g
    colors[base + 2] = b
  }

  const coloringTime = performance.now() - start

  // 拷贝一份颜色数据用于主线程渲染，避免数据争用
  const updatedColors = colors.slice()
  return { colors: updatedColors.buffer, coloringTime }
}

// 优化的射线法：使用预拆分的 x/y 数组避免属性访问
function isPointInPolygon(px: number, py: number, pathXs: Float32Array, pathYs: Float32Array): boolean {
  let inside = false
  const n = pathXs.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pathXs[i]
    const yi = pathYs[i]
    const xj = pathXs[j]
    const yj = pathYs[j]

    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}
