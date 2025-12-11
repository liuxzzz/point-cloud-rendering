/// <reference lib="webworker" />

import type { LassoPoint, PointCloudData } from "../types"

type Viewport = { width: number; height: number }

type InitMessage = {
  type: "init"
  payload: PointCloudData
}

type ParseMessage = {
  type: "parse"
  payload: {
    arrayBuffer: ArrayBuffer
  }
}

type SelectMessage = {
  type: "select"
  payload: {
    path: LassoPoint[]
    viewProjectionMatrix: Float32Array
    viewport: Viewport
    // 可选的范围参数，用于并行处理
    startIndex?: number
    endIndex?: number
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
} & (InitMessage | ParseMessage | SelectMessage | ColorMessage)

type SuccessResponse =
  | {
      type: "init"
      result: { count: number }
    }
  | {
      type: "parse"
      result: { data: PointCloudData }
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
      case "parse": {
        // 🔧 修复：解析 PCD 文件，但不保存到全局变量
        // 因为数据会通过 transfer 发送到主线程，导致 buffer 被清空
        // 主线程会在接收后通过 init 消息重新初始化所有 Worker
        const result = handleParse((payload as ParseMessage["payload"]).arrayBuffer)
        response = {
          id,
          success: true,
          data: { type: "parse", result },
          transfer: [result.data.positions.buffer, result.data.colors.buffer],
        }
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
  startIndex,
  endIndex,
}: SelectMessage["payload"]): { indices: Uint32Array; searchTime: number } {
  if (!positions) {
    throw new Error("Point data is not initialized")
  }

  const start = performance.now()

  // 快速返回
  if (path.length < 3 || viewport.width === 0 || viewport.height === 0 || viewProjectionMatrix.length !== 16) {
    return { indices: new Uint32Array(), searchTime: performance.now() - start }
  }

  // 确定处理范围（支持并行分片）
  const rangeStart = startIndex ?? 0
  const rangeEnd = endIndex ?? pointCount

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

  // 🚀 预分配数组，避免动态扩容
  const rangeSize = rangeEnd - rangeStart
  const selectedBuffer = new Uint32Array(rangeSize)
  let selectedCount = 0

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

  // 🚀 只处理指定范围的点
  for (let i = rangeStart; i < rangeEnd; i++) {
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
      selectedBuffer[selectedCount++] = i
    }
  }

  // 🚀 返回实际大小的数组
  const indices = selectedBuffer.subarray(0, selectedCount)
  const searchTime = performance.now() - start
  return { indices: new Uint32Array(indices), searchTime }
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

// ===== PCD 解析逻辑 =====

interface PCDHeader {
  version: string
  fields: string[]
  size: number[]
  type: string[]
  count: number[]
  width: number
  height: number
  viewpoint: number[]
  points: number
  data: "ascii" | "binary" | "binary_compressed"
  headerLen: number
  offset: { [key: string]: number }
  rowSize: number
}

function parseHeader(data: string): PCDHeader {
  const header: Partial<PCDHeader> = {
    version: "",
    fields: [],
    size: [],
    type: [],
    count: [],
    width: 0,
    height: 0,
    viewpoint: [0, 0, 0, 1, 0, 0, 0],
    points: 0,
    data: "ascii",
    offset: {},
    rowSize: 0,
  }

  const lines = data.split("\n")
  let headerLen = 0

  for (const line of lines) {
    headerLen += line.length + 1
    const parts = line.trim().split(/\s+/)

    if (parts.length === 0) continue

    switch (parts[0]) {
      case "VERSION":
        header.version = parts[1]
        break
      case "FIELDS":
        header.fields = parts.slice(1)
        break
      case "SIZE":
        header.size = parts.slice(1).map(Number)
        break
      case "TYPE":
        header.type = parts.slice(1)
        break
      case "COUNT":
        header.count = parts.slice(1).map(Number)
        break
      case "WIDTH":
        header.width = Number.parseInt(parts[1], 10)
        break
      case "HEIGHT":
        header.height = Number.parseInt(parts[1], 10)
        break
      case "VIEWPOINT":
        header.viewpoint = parts.slice(1).map(Number)
        break
      case "POINTS":
        header.points = Number.parseInt(parts[1], 10)
        break
      case "DATA":
        header.data = parts[1].toLowerCase() as "ascii" | "binary" | "binary_compressed"
        break
    }

    if (parts[0] === "DATA") break
  }

  header.headerLen = headerLen

  // Calculate offsets
  let offset = 0
  for (let i = 0; i < header.fields!.length; i++) {
    header.offset![header.fields![i]] = offset
    offset += header.size![i] * (header.count![i] || 1)
  }
  header.rowSize = offset

  return header as PCDHeader
}

function handleParse(arrayBuffer: ArrayBuffer): { data: PointCloudData } {
  // 1. 解析文件头部
  const textDecoder = new TextDecoder()
  const headerText = textDecoder.decode(new Uint8Array(arrayBuffer, 0, Math.min(4096, arrayBuffer.byteLength)))
  const header = parseHeader(headerText)

  // 2. 初始化存储数组
  const positions: number[] = []
  const colorsArray: number[] = []

  // 3. 根据数据格式解析点云数据
  if (header.data === "ascii") {
    // ASCII 格式
    const text = textDecoder.decode(arrayBuffer)
    const lines = text.split("\n")
    let dataStarted = false

    for (const line of lines) {
      if (line.trim().startsWith("DATA")) {
        dataStarted = true
        continue
      }

      if (!dataStarted) continue

      const parts = line.trim().split(/\s+/)
      if (parts.length < 3) continue

      const x = Number.parseFloat(parts[header.fields.indexOf("x")])
      const y = Number.parseFloat(parts[header.fields.indexOf("y")])
      const z = Number.parseFloat(parts[header.fields.indexOf("z")])

      if (isNaN(x) || isNaN(y) || isNaN(z)) continue

      positions.push(x, y, z)

      // 解析 RGB 颜色
      const rgbIndex = header.fields.indexOf("rgb")
      if (rgbIndex !== -1 && parts[rgbIndex]) {
        const rgb = Number.parseFloat(parts[rgbIndex])
        const intRgb = new Float32Array([rgb])
        const view = new DataView(intRgb.buffer)
        const intVal = view.getInt32(0, true)
        const r = ((intVal >> 16) & 0xff) / 255
        const g = ((intVal >> 8) & 0xff) / 255
        const b = (intVal & 0xff) / 255
        colorsArray.push(r, g, b)
      } else {
        colorsArray.push(1, 1, 1)
      }
    }
  } else if (header.data === "binary") {
    // 二进制格式
    const dataView = new DataView(arrayBuffer, header.headerLen)

    const xOffset = header.offset["x"] ?? 0
    const yOffset = header.offset["y"] ?? 4
    const zOffset = header.offset["z"] ?? 8
    const rgbOffset = header.offset["rgb"]

    for (let i = 0; i < header.points; i++) {
      const rowOffset = i * header.rowSize

      const x = dataView.getFloat32(rowOffset + xOffset, true)
      const y = dataView.getFloat32(rowOffset + yOffset, true)
      const z = dataView.getFloat32(rowOffset + zOffset, true)

      if (isNaN(x) || isNaN(y) || isNaN(z)) continue

      positions.push(x, y, z)

      if (rgbOffset !== undefined) {
        const rgb = dataView.getFloat32(rowOffset + rgbOffset, true)
        const intRgb = new Float32Array([rgb])
        const view = new DataView(intRgb.buffer)
        const intVal = view.getInt32(0, true)
        const r = ((intVal >> 16) & 0xff) / 255
        const g = ((intVal >> 8) & 0xff) / 255
        const b = (intVal & 0xff) / 255
        colorsArray.push(r, g, b)
      } else {
        colorsArray.push(1, 1, 1)
      }
    }
  }

  return {
    data: {
      positions: new Float32Array(positions),
      colors: new Float32Array(colorsArray),
      count: positions.length / 3,
    },
  }
}
