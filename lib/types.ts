export interface PointCloudData {
  positions: number[]
  colors: number[]
  count: number
}

export type SelectionMode = "orbit" | "lasso"

export interface LassoPoint {
  x: number
  y: number
}
