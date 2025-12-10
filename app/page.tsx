"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { PointCloudViewer } from "@/components/point-cloud-viewer"
import { FileUploader } from "@/components/file-uploader"
import { Toolbar } from "@/components/toolbar"
import { parsePCD } from "@/lib/pcd-parser"
import type { PointCloudData, SelectionMode } from "@/lib/types"
import { PointWorkerClient } from "@/lib/point-worker-client"

export default function Home() {
  const [pointCloud, setPointCloud] = useState<PointCloudData | null>(null)
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("orbit")
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [lastSearchTime, setLastSearchTime] = useState<number>(0)
  const [lastColoringTime, setLastColoringTime] = useState<number>(0)
  const workerRef = useRef<PointWorkerClient | null>(null)

  // 初始化并保持单例 Worker
  useEffect(() => {
    const worker = new PointWorkerClient()
    workerRef.current = worker

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  const handleFileUpload = useCallback(async (file: File) => {
    setIsLoading(true)
    try {
      // 将文件转换为 ArrayBuffer（二进制数据）
      const arrayBuffer = await file.arrayBuffer()
      const data = parsePCD(arrayBuffer)
      setPointCloud(data)
      setSelectedIndices(new Set())
      // 同步数据到 Worker
      workerRef.current?.init(data).catch((err) => {
        console.error("初始化 Worker 失败", err)
      })
    } catch (error) {
      console.error("Failed to parse PCD file:", error)
      alert("Failed to parse PCD file. Please ensure it's a valid PCD format.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleSelectionComplete = useCallback((indices: number[], searchTime: number) => {
    setLastSearchTime(searchTime)
    setSelectedIndices(new Set(indices))
    // 选择完成后自动退出套索模式
    setSelectionMode("orbit")
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectedIndices(new Set())
    // 清除时间统计，还原到初始状态
    setLastSearchTime(0)
    setLastColoringTime(0)
    // 切换回orbit模式
    setSelectionMode("orbit")
  }, [])

  const handleColorSelection = useCallback(
    async (color: string) => {
      if (!pointCloud || selectedIndices.size === 0 || !workerRef.current) return

      const hex = color.replace("#", "")
      const r = Number.parseInt(hex.substring(0, 2), 16) / 255
      const g = Number.parseInt(hex.substring(2, 4), 16) / 255
      const b = Number.parseInt(hex.substring(4, 6), 16) / 255

      const indicesArray = new Uint32Array(selectedIndices.size)
      let offset = 0
      selectedIndices.forEach((index) => {
        indicesArray[offset++] = index
      })

      try {
        const { colors, coloringTime } = await workerRef.current.color({
          indices: indicesArray,
          color: [r, g, b],
        })

        setPointCloud({ ...pointCloud, colors })
        setLastColoringTime(coloringTime)
        setSelectedIndices(new Set())


      } catch (error) {
        console.error("Worker 上色失败", error)
      }
    },
    [pointCloud, selectedIndices],
  )

  return (
    <main className="h-screen w-full flex flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <h1 className="text-xl font-bold text-foreground">Point Cloud Viewer</h1>
        <div className="flex items-center gap-4">
          <FileUploader onUpload={handleFileUpload} isLoading={isLoading} />
        </div>
      </header>

      {pointCloud && (
        <Toolbar
          selectionMode={selectionMode}
          onModeChange={setSelectionMode}
          selectedCount={selectedIndices.size}
          onClearSelection={handleClearSelection}
          onColorSelection={handleColorSelection}
        />
      )}

      <div className="flex-1 relative">
        {!pointCloud ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center">
                <svg className="w-12 h-12 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">Upload a Point Cloud File</h2>
              <p className="text-muted-foreground text-sm max-w-sm">
                Drag and drop a PCD file or click the upload button to get started. Supports ASCII and binary PCD
                formats.
              </p>
            </div>
          </div>
        ) : (
          <PointCloudViewer
            pointCloud={pointCloud}
            selectionMode={selectionMode}
            selectedIndices={selectedIndices}
            onSelectionComplete={handleSelectionComplete}
            workerClient={workerRef.current}
          />
        )}
      </div>

      {pointCloud && (
        <footer className="px-6 py-3 border-t border-border bg-card">
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <span>Points: {pointCloud.count.toLocaleString()}</span>
            <span>Selected: {selectedIndices.size.toLocaleString()}</span>
            {lastSearchTime > 0 && (
              <span>搜索耗时: {lastSearchTime.toFixed(2)} ms</span>
            )}
            {lastColoringTime > 0 && (
              <span>上色耗时: {lastColoringTime.toFixed(2)} ms</span>
            )}
            {lastSearchTime > 0 && lastColoringTime > 0 && (
              <span className="font-semibold text-foreground">
                总耗时: {(lastSearchTime + lastColoringTime).toFixed(2)} ms
              </span>
            )}
          </div>
        </footer>
      )}
    </main>
  )
}
