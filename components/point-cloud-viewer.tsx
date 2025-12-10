"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import { Canvas, useThree, useFrame } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import * as THREE from "three"
import type { PointCloudData, SelectionMode, LassoPoint } from "@/lib/types"
import { LassoOverlay } from "./lasso-overlay"

interface PointCloudViewerProps {
  pointCloud: PointCloudData
  selectionMode: SelectionMode
  selectedIndices: Set<number>
  onSelectionComplete: (indices: number[], searchTime: number) => void
}

function PointCloudMesh({
  pointCloud,
  selectedIndices,
}: {
  pointCloud: PointCloudData
  selectedIndices: Set<number>
}) {
  const pointsRef = useRef<THREE.Points>(null)

  useEffect(() => {
    if (!pointsRef.current) return

    const geometry = pointsRef.current.geometry
    
    // 如果有选中的点，只渲染选中的部分
    if (selectedIndices.size > 0) {
      const selectedPositions: number[] = []
      const selectedColors: number[] = []
      
      selectedIndices.forEach((index) => {
        const i = index * 3
        // 获取该点的位置
        selectedPositions.push(
          pointCloud.positions[i],
          pointCloud.positions[i + 1],
          pointCloud.positions[i + 2]
        )
        // 获取该点的颜色
        selectedColors.push(
          pointCloud.colors[i],
          pointCloud.colors[i + 1],
          pointCloud.colors[i + 2]
        )
      })
      
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(selectedPositions), 3))
      geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(selectedColors), 3))
    } else {
      // 没有选中时，渲染所有点
      // 🚀 优化：直接使用原数组，不创建新的 TypedArray
      const positionAttr = geometry.getAttribute("position")
      const colorAttr = geometry.getAttribute("color")
      
      if (!positionAttr || positionAttr.count !== pointCloud.positions.length / 3) {
        // 首次创建或大小改变
        geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pointCloud.positions), 3))
        geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(pointCloud.colors), 3))
      } else {
        // 🚀 直接更新现有 BufferAttribute，避免重新创建
        const positions = positionAttr.array as Float32Array
        const colors = colorAttr.array as Float32Array
        
        // 复制数据到现有 buffer
        positions.set(pointCloud.positions)
        colors.set(pointCloud.colors)
        
        // 标记需要更新
        positionAttr.needsUpdate = true
        colorAttr.needsUpdate = true
      }
    }
    
    geometry.computeBoundingSphere() //设置边界球，用于相机定位和渲染优化
  }, [pointCloud, selectedIndices])

  return (
    // 使用react-three-fiber 来代替传统Three.js的api，自动管理Three.js的实例生命周期，避免内存泄漏。
    <points ref={pointsRef}>
      <bufferGeometry />
      <pointsMaterial size={0.02} vertexColors sizeAttenuation />
    </points>
  )
}

function CameraController({
  pointCloud,
  selectionMode,
}: {
  pointCloud: PointCloudData
  selectionMode: SelectionMode
}) {
  const { camera } = useThree()
  const controlsRef = useRef<any>(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    // Calculate bounding box
    const positions = pointCloud.positions
    let minX = Number.POSITIVE_INFINITY,
      minY = Number.POSITIVE_INFINITY,
      minZ = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY,
      maxY = Number.NEGATIVE_INFINITY,
      maxZ = Number.NEGATIVE_INFINITY

    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i])
      maxX = Math.max(maxX, positions[i])
      minY = Math.min(minY, positions[i + 1])
      maxY = Math.max(maxY, positions[i + 1])
      minZ = Math.min(minZ, positions[i + 2])
      maxZ = Math.max(maxZ, positions[i + 2])
    }

    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const centerZ = (minZ + maxZ) / 2

    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ)

    camera.position.set(centerX + size, centerY + size, centerZ + size)
    camera.lookAt(centerX, centerY, centerZ)

    if (controlsRef.current) {
      controlsRef.current.target.set(centerX, centerY, centerZ)
      controlsRef.current.update()
    }
  }, [pointCloud, camera])

  return <OrbitControls ref={controlsRef} enabled={selectionMode === "orbit"} enableDamping dampingFactor={0.05} />
}

function SceneContent({
  pointCloud,
  selectionMode,
  selectedIndices,
  onComputeProjection,
}: {
  pointCloud: PointCloudData
  selectionMode: SelectionMode
  selectedIndices: Set<number>
  onComputeProjection: (compute: () => { index: number; x: number; y: number }[]) => void
}) {
  const { camera, gl } = useThree()

  // 优化：不再在 useFrame 中每帧计算投影，而是提供一个计算函数
  // 这样只在需要时（套索完成时）才进行一次投影计算
  useEffect(() => {
    const computeProjection = () => {
      const projectedPoints: { index: number; x: number; y: number }[] = []
      const positions = pointCloud.positions
      const vector = new THREE.Vector3()
      
      // 优化：缓存画布尺寸，避免重复访问 DOM
      const canvasWidth = gl.domElement.clientWidth
      const canvasHeight = gl.domElement.clientHeight

      // 优化：批量处理，减少函数调用
      for (let i = 0; i < positions.length; i += 3) {
        const px = positions[i]
        const py = positions[i + 1]
        const pz = positions[i + 2]
        
        vector.set(px, py, pz)
        vector.project(camera)

        // 优化：只在可见时才创建对象
        if (vector.z < 1) {
          const x = ((vector.x + 1) * 0.5) * canvasWidth
          const y = ((-vector.y + 1) * 0.5) * canvasHeight
          projectedPoints.push({ index: i / 3, x, y })
        }
      }

      return projectedPoints
    }

    onComputeProjection(computeProjection)
  }, [pointCloud, camera, gl, onComputeProjection])

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 10]} intensity={1} />
      <PointCloudMesh pointCloud={pointCloud} selectedIndices={selectedIndices} />
      <CameraController pointCloud={pointCloud} selectionMode={selectionMode} />
    </>
  )
}

export function PointCloudViewer({
  pointCloud,
  selectionMode,
  selectedIndices,
  onSelectionComplete,
}: PointCloudViewerProps) {
  const [lassoPath, setLassoPath] = useState<LassoPoint[]>([])
  // 优化：存储计算函数而不是投影结果，避免每帧存储 600MB 数据
  const computeProjectionRef = useRef<(() => { index: number; x: number; y: number }[]) | null>(null)

  const handleComputeProjection = useCallback((compute: () => { index: number; x: number; y: number }[]) => {
    computeProjectionRef.current = compute
  }, [])

  const handleLassoComplete = useCallback(
    (path: LassoPoint[]) => {
      if (path.length < 3) {
        setLassoPath([])
        return
      }
      
      // 记录搜索开始时间
      const searchStartTime = performance.now()
      
      // 优化1：计算套索的边界框（Bounding Box）用于快速筛选
      let minX = Infinity, maxX = -Infinity
      let minY = Infinity, maxY = -Infinity
      for (let i = 0; i < path.length; i++) {
        const p = path[i]
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
      }
      
      // 优化2：使用优化的投影计算（直接操作 TypedArray，减少对象创建）
      const projectedPoints = computeProjectionRef.current ? computeProjectionRef.current() : []
      
      // Find points inside the lasso polygon
      const selectedPoints: number[] = []
      let insideBBoxCount = 0
      let totalChecked = 0
      
      for (const point of projectedPoints) {
        totalChecked++
        
        // 优化3：边界框快速筛选（只需4次比较，vs 150+次多边形判断）
        if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) {
          continue // 明显在边界框外，直接跳过
        }
        
        insideBBoxCount++
        
        // 优化4：只对边界框内的点做精确的多边形判断
        if (isPointInPolygon(point, path)) {
          selectedPoints.push(point.index)
        }
      }
      
      // 记录搜索结束时间并计算搜索耗时
      const searchEndTime = performance.now()
      const searchTime = searchEndTime - searchStartTime

      onSelectionComplete(selectedPoints, searchTime)
      setLassoPath([])
    },
    [onSelectionComplete],
  )

  return (
    <div className="w-full h-full relative">
      <Canvas camera={{ fov: 60, near: 0.01, far: 1000 }} style={{ background: "#1a1a2e" }}>
        <SceneContent
          pointCloud={pointCloud}
          selectionMode={selectionMode}
          selectedIndices={selectedIndices}
          onComputeProjection={handleComputeProjection}
        />
      </Canvas>

      {selectionMode === "lasso" && (
        <LassoOverlay onPathUpdate={setLassoPath} onComplete={handleLassoComplete} />
      )}
    </div>
  )
}

// 优化的 Ray-Casting 算法：减少对象属性访问
function isPointInPolygon(point: { x: number; y: number }, polygon: LassoPoint[]): boolean {
  let inside = false
  const n = polygon.length
  const px = point.x
  const py = point.y

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y

    // 优化：减少属性访问，使用局部变量
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }

  return inside
}
