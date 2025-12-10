"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import { Canvas, useThree } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import * as THREE from "three"
import type { PointCloudData, SelectionMode, LassoPoint } from "@/lib/types"
import { LassoOverlay } from "./lasso-overlay"
import { PointWorkerClient } from "@/lib/point-worker-client"

interface PointCloudViewerProps {
  pointCloud: PointCloudData
  selectionMode: SelectionMode
  selectedIndices: Set<number>
  onSelectionComplete: (indices: number[], searchTime: number) => void
  workerClient?: PointWorkerClient | null
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
      
      if (
        !positionAttr ||
        !colorAttr ||
        positionAttr.count !== pointCloud.positions.length / 3 ||
        colorAttr.count !== pointCloud.colors.length / 3 ||
        positionAttr.array !== pointCloud.positions ||
        colorAttr.array !== pointCloud.colors
      ) {
        // 首次创建或大小改变 / 数据引用变化
        geometry.setAttribute("position", new THREE.BufferAttribute(pointCloud.positions, 3))
        geometry.setAttribute("color", new THREE.BufferAttribute(pointCloud.colors, 3))
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
  onComputeProjection: (
    compute: () => {
      viewProjectionMatrix: Float32Array
      viewport: { width: number; height: number }
    },
  ) => void
}) {
  const { camera, gl } = useThree()

  // 将相机矩阵与视口信息提供给主线程，供 Worker 投影使用
  useEffect(() => {
    const compute = () => {
      const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      return {
        viewProjectionMatrix: new Float32Array(viewProjection.elements),
        viewport: {
          width: gl.domElement.clientWidth,
          height: gl.domElement.clientHeight,
        },
      }
    }

    onComputeProjection(compute)
  }, [camera, gl, onComputeProjection])

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
  workerClient,
}: PointCloudViewerProps) {
  const [lassoPath, setLassoPath] = useState<LassoPoint[]>([])
  // 存储相机矩阵/视口计算函数，在套索完成时交由 Worker 使用
  const computeProjectionRef = useRef<
    (() => { viewProjectionMatrix: Float32Array; viewport: { width: number; height: number } }) | null
  >(null)

  const handleComputeProjection = useCallback(
    (compute: () => { viewProjectionMatrix: Float32Array; viewport: { width: number; height: number } }) => {
      computeProjectionRef.current = compute
    },
    [],
  )

  const handleLassoComplete = useCallback(
    async (path: LassoPoint[]) => {
      setLassoPath([])

      if (path.length < 3) {
        return
      }
      
      const cameraInfo = computeProjectionRef.current ? computeProjectionRef.current() : null
      if (!cameraInfo || !workerClient) {
        console.warn("Worker 未准备好，跳过选点计算")
        return
      }

      try {
        const { indices, searchTime } = await workerClient.select({
          path,
          viewProjectionMatrix: cameraInfo.viewProjectionMatrix,
          viewport: cameraInfo.viewport,
        })

        onSelectionComplete(Array.from(indices), searchTime)
      } catch (error) {
        console.error("套索选点 Worker 计算失败", error)
      }
    },
    [onSelectionComplete, workerClient],
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

