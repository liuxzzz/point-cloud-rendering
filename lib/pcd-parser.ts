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

export function parsePCD(arrayBuffer: ArrayBuffer): PointCloudData {
  const textDecoder = new TextDecoder()
  const headerText = textDecoder.decode(new Uint8Array(arrayBuffer, 0, Math.min(4096, arrayBuffer.byteLength)))
  const header = parseHeader(headerText)

  const positions: number[] = []
  const colors: number[] = []

  if (header.data === "ascii") {
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

      // Parse RGB if available
      const rgbIndex = header.fields.indexOf("rgb")
      if (rgbIndex !== -1 && parts[rgbIndex]) {
        const rgb = Number.parseFloat(parts[rgbIndex])
        const intRgb = new Float32Array([rgb])
        const view = new DataView(intRgb.buffer)
        const intVal = view.getInt32(0, true)
        const r = ((intVal >> 16) & 0xff) / 255
        const g = ((intVal >> 8) & 0xff) / 255
        const b = (intVal & 0xff) / 255
        colors.push(r, g, b)
      } else {
        // Default white color
        colors.push(1, 1, 1)
      }
    }
  } else if (header.data === "binary") {
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
        colors.push(r, g, b)
      } else {
        colors.push(1, 1, 1)
      }
    }
  }

  return {
    positions,
    colors,
    count: positions.length / 3,
  }
}
