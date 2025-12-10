export interface PointCloudData {
  positions: Float32Array
  colors: Float32Array
  count: number
}

export type SelectionMode = "orbit" | "lasso"

export interface LassoPoint {
  x: number
  y: number
}
