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
  onSelectionComplete: (indices: number[], startTime: number) => void
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
        // 获取该点的位置
        selectedPositions.push(
          pointCloud.positions[index * 3],
          pointCloud.positions[index * 3 + 1],
          pointCloud.positions[index * 3 + 2]
        )
        // 获取该点的颜色
        selectedColors.push(
          pointCloud.colors[index * 3],
          pointCloud.colors[index * 3 + 1],
          pointCloud.colors[index * 3 + 2]
        )
      })
      
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(selectedPositions), 3))
      geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(selectedColors), 3))
    } else {
      // 没有选中时，渲染所有点
      const positions = new Float32Array(pointCloud.positions)
      const colors = new Float32Array(pointCloud.colors)
      
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
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
  lassoPath,
  onProjectedPoints,
}: {
  pointCloud: PointCloudData
  selectionMode: SelectionMode
  selectedIndices: Set<number>
  lassoPath: LassoPoint[]
  onProjectedPoints: (points: { index: number; x: number; y: number }[]) => void
}) {
  const { camera, gl } = useThree()

  useFrame(() => {
    if (selectionMode !== "lasso" || lassoPath.length === 0) return

    const projectedPoints: { index: number; x: number; y: number }[] = []
    const positions = pointCloud.positions
    const vector = new THREE.Vector3()

    for (let i = 0; i < positions.length; i += 3) {
      vector.set(positions[i], positions[i + 1], positions[i + 2])
      vector.project(camera)

      const x = ((vector.x + 1) / 2) * gl.domElement.clientWidth
      const y = ((-vector.y + 1) / 2) * gl.domElement.clientHeight

      if (vector.z < 1) {
        projectedPoints.push({ index: i / 3, x, y })
      }
    }

    onProjectedPoints(projectedPoints)
  })

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
  const projectedPointsRef = useRef<{ index: number; x: number; y: number }[]>([])
  const selectionStartTimeRef = useRef<number>(0)

  const handleProjectedPoints = useCallback((points: { index: number; x: number; y: number }[]) => {
    projectedPointsRef.current = points
  }, [])

  const handleLassoStart = useCallback(() => {
    selectionStartTimeRef.current = performance.now()
  }, [])

  const handleLassoComplete = useCallback(
    (path: LassoPoint[]) => {
      if (path.length < 3) {
        setLassoPath([])
        return
      }

      // Find points inside the lasso polygon
      const selectedPoints: number[] = []

      for (const point of projectedPointsRef.current) {
        if (isPointInPolygon(point, path)) {
          selectedPoints.push(point.index)
        }
      }

      onSelectionComplete(selectedPoints, selectionStartTimeRef.current)
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
          lassoPath={lassoPath}
          onProjectedPoints={handleProjectedPoints}
        />
      </Canvas>

      {selectionMode === "lasso" && (
        <LassoOverlay onPathUpdate={setLassoPath} onComplete={handleLassoComplete} onStart={handleLassoStart} />
      )}
    </div>
  )
}

function isPointInPolygon(point: { x: number; y: number }, polygon: LassoPoint[]): boolean {
  let inside = false
  const n = polygon.length

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y

    if (yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }

  return inside
}
