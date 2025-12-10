import type { PointCloudData } from "./types"

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

/**
 * 解析 PCD (Point Cloud Data) 文件
 * 
 * PCD 文件格式说明：
 * - 文件由头部（文本）和数据部分（ASCII 或二进制）组成
 * - 头部包含元数据：字段名、数据类型、点数量等
 * - 数据部分包含每个点的坐标（x, y, z）和可选的 RGB 颜色信息
 * 
 * @param arrayBuffer - 文件的二进制数据
 * @returns 标准化的点云数据，包含位置数组、颜色数组和点数量
 */
export function parsePCD(arrayBuffer: ArrayBuffer): PointCloudData {
  // 1. 解析文件头部（前 4096 字节通常足够包含所有头部信息）
  const textDecoder = new TextDecoder()
  const headerText = textDecoder.decode(new Uint8Array(arrayBuffer, 0, Math.min(4096, arrayBuffer.byteLength)))
  const header = parseHeader(headerText)


  // 2. 初始化存储数组
  // positions: [x1, y1, z1, x2, y2, z2, ...] - 每个点 3 个值
  // colors: [r1, g1, b1, r2, g2, b2, ...] - 每个点 3 个值，范围 0-1
  const positions: number[] = []
  const colors: number[] = []

  // 3. 根据数据格式解析点云数据
  if (header.data === "ascii") {
    // ASCII 格式：文本格式，每行一个点，字段用空格分隔
    const text = textDecoder.decode(arrayBuffer)
    const lines = text.split("\n")
    let dataStarted = false

    for (const line of lines) {
      // 找到 DATA 标记，之后才是实际数据
      if (line.trim().startsWith("DATA")) {
        dataStarted = true
        continue
      }

      if (!dataStarted) continue

      const parts = line.trim().split(/\s+/)
      if (parts.length < 3) continue

      // 提取 x, y, z 坐标（字段顺序可能不同，需要根据字段名查找）
      const x = Number.parseFloat(parts[header.fields.indexOf("x")])
      const y = Number.parseFloat(parts[header.fields.indexOf("y")])
      const z = Number.parseFloat(parts[header.fields.indexOf("z")])

      // 跳过无效数据
      if (isNaN(x) || isNaN(y) || isNaN(z)) continue

      positions.push(x, y, z)

      // 解析 RGB 颜色（如果存在）
      // PCD 格式中，RGB 通常打包为一个浮点数：R(8位) + G(8位) + B(8位)
      const rgbIndex = header.fields.indexOf("rgb")
      if (rgbIndex !== -1 && parts[rgbIndex]) {
        const rgb = Number.parseFloat(parts[rgbIndex])
        // 将浮点数转换为整数，然后提取 RGB 分量
        const intRgb = new Float32Array([rgb])
        const view = new DataView(intRgb.buffer)
        const intVal = view.getInt32(0, true)
        // 位操作提取：R 在高 8 位，G 在中 8 位，B 在低 8 位
        const r = ((intVal >> 16) & 0xff) / 255
        const g = ((intVal >> 8) & 0xff) / 255
        const b = (intVal & 0xff) / 255
        colors.push(r, g, b)
      } else {
        // 如果没有颜色信息，使用默认白色
        colors.push(1, 1, 1)
      }
    }
  } else if (header.data === "binary") {
    // 二进制格式：更高效，适合大文件
    // 使用 DataView 直接读取二进制数据，跳过头部
    const dataView = new DataView(arrayBuffer, header.headerLen)

    // 获取各字段在每行数据中的字节偏移量（在 parseHeader 中已计算）
    const xOffset = header.offset["x"] ?? 0
    const yOffset = header.offset["y"] ?? 4
    const zOffset = header.offset["z"] ?? 8
    const rgbOffset = header.offset["rgb"]

    // 遍历每个点
    for (let i = 0; i < header.points; i++) {
      // 计算当前点在二进制数据中的起始位置
      const rowOffset = i * header.rowSize

      // 读取坐标（Float32，小端序）
      const x = dataView.getFloat32(rowOffset + xOffset, true)
      const y = dataView.getFloat32(rowOffset + yOffset, true)
      const z = dataView.getFloat32(rowOffset + zOffset, true)

      // 跳过无效数据
      if (isNaN(x) || isNaN(y) || isNaN(z)) continue

      positions.push(x, y, z)

      // 解析 RGB（与 ASCII 格式相同的处理方式）
      if (rgbOffset !== undefined) {
        const rgb = dataView.getFloat32(rowOffset + rgbOffset, true)
        const intRgb = new Float32Array([rgb])
        const view = new DataView(intRgb.buffer)
        const intVal = view.getInt32(0, true)
        const r = ((intVal >> 16) & 0xff) / 255
        const g = ((intVal >> 8) & 0xff) / 255
        const b = (intVal & 0xff) / 255
        colors.push(r, g, b)
      } else {
        colors.push(1, 1, 1)
      }
    }
  }

  // 4. 返回标准化的点云数据格式
  // 这种格式可以直接用于 Three.js 的 BufferGeometry
  return {
    positions: new Float32Array(positions), // 扁平化的坐标数组：[x1, y1, z1, x2, y2, z2, ...]
    colors: new Float32Array(colors),    // 扁平化的颜色数组：[r1, g1, b1, r2, g2, b2, ...]，值范围 0-1
    count: positions.length / 3, // 点的数量
  }
}
