"use client"

import { useState, useCallback } from "react"
import { PointCloudViewer } from "@/components/point-cloud-viewer"
import { FileUploader } from "@/components/file-uploader"
import { Toolbar } from "@/components/toolbar"
import { parsePCD } from "@/lib/pcd-parser"
import type { PointCloudData, SelectionMode } from "@/lib/types"

export default function Home() {
  const [pointCloud, setPointCloud] = useState<PointCloudData | null>(null)
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("orbit")
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const [isLoading, setIsLoading] = useState(false)

  const handleFileUpload = useCallback(async (file: File) => {
    setIsLoading(true)
    try {
      // 将文件转换为 ArrayBuffer（二进制数据）
      const arrayBuffer = await file.arrayBuffer()
      const data = parsePCD(arrayBuffer)
      setPointCloud(data)
      setSelectedIndices(new Set())
    } catch (error) {
      console.error("Failed to parse PCD file:", error)
      alert("Failed to parse PCD file. Please ensure it's a valid PCD format.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleSelectionComplete = useCallback((indices: number[]) => {
    setSelectedIndices(new Set(indices))
    setSelectionMode("orbit")
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectedIndices(new Set())
  }, [])

  const handleColorSelection = useCallback(
    (color: string) => {
      if (pointCloud && selectedIndices.size > 0) {
        const newColors = [...pointCloud.colors]
        const hex = color.replace("#", "")
        const r = Number.parseInt(hex.substring(0, 2), 16) / 255
        const g = Number.parseInt(hex.substring(2, 4), 16) / 255
        const b = Number.parseInt(hex.substring(4, 6), 16) / 255

        selectedIndices.forEach((index) => {
          newColors[index * 3] = r
          newColors[index * 3 + 1] = g
          newColors[index * 3 + 2] = b
        })

        setPointCloud({ ...pointCloud, colors: newColors })
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
          />
        )}
      </div>

      {pointCloud && (
        <footer className="px-6 py-3 border-t border-border bg-card">
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <span>Points: {pointCloud.count.toLocaleString()}</span>
            <span>Selected: {selectedIndices.size.toLocaleString()}</span>
          </div>
        </footer>
      )}
    </main>
  )
}
