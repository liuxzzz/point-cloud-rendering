"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { PointCloudViewer } from "@/components/point-cloud-viewer";
import { FileUploader } from "@/components/file-uploader";
import { Toolbar } from "@/components/toolbar";
import type { PointCloudData, SelectionMode } from "@/lib/types";
import { ParallelPointWorkerClient } from "@/lib/parallel-point-worker-client";

export default function Home() {
  const [pointCloud, setPointCloud] = useState<PointCloudData | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("orbit");
  const [selectedIndices, setSelectedIndices] = useState<Uint32Array>(
    new Uint32Array()
  );
  const [isLoading, setIsLoading] = useState(false);
  const [lastSearchTime, setLastSearchTime] = useState<number>(0);
  const [lastColoringTime, setLastColoringTime] = useState<number>(0);
  const [workerCount, setWorkerCount] = useState<number>(0);
  const workerRef = useRef<ParallelPointWorkerClient | null>(null);

  // 初始化并保持 Worker 池
  useEffect(() => {
    const worker = new ParallelPointWorkerClient();
    workerRef.current = worker;
    setWorkerCount(worker.getWorkerCount());

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const handleFileUpload = useCallback(async (file: File) => {
    setIsLoading(true);
    try {
      // 将文件转换为 ArrayBuffer（二进制数据）
      const arrayBuffer = await file.arrayBuffer();

      // 🔧 使用 Worker 在后台解析文件，避免阻塞主线程
      // Worker 会使用 transfer 将数据发送回主线程（零拷贝），然后重新 init 所有 Worker
      if (!workerRef.current) {
        throw new Error("Worker 未初始化");
      }

      const data = await workerRef.current.parse(arrayBuffer);

      setPointCloud(data);
      setSelectedIndices(new Uint32Array());
    } catch (error) {
      console.error("Failed to parse PCD file:", error);
      alert("Failed to parse PCD file. Please ensure it's a valid PCD format.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSelectionComplete = useCallback(
    (indices: Uint32Array, searchTime: number) => {
      setLastSearchTime(searchTime);
      setSelectedIndices(indices);
      // 选择完成后自动退出套索模式
      setSelectionMode("orbit");
    },
    []
  );

  const handleClearSelection = useCallback(() => {
    setSelectedIndices(new Uint32Array());
    // 清除时间统计，还原到初始状态（保留解析时间）
    setLastSearchTime(0);
    setLastColoringTime(0);
    // 切换回orbit模式
    setSelectionMode("orbit");
  }, []);

  const handleColorSelection = useCallback(
    (color: string) => {
      if (!pointCloud || selectedIndices.length === 0) return;

      const start = performance.now();

      const hex = color.replace("#", "");
      const r = Number.parseInt(hex.substring(0, 2), 16) / 255;
      const g = Number.parseInt(hex.substring(2, 4), 16) / 255;
      const b = Number.parseInt(hex.substring(4, 6), 16) / 255;

      // 直接在主线程修改颜色数组
      const colors = pointCloud.colors;
      for (let i = 0; i < selectedIndices.length; i++) {
        const base = selectedIndices[i] * 3;
        colors[base] = r;
        colors[base + 1] = g;
        colors[base + 2] = b;
      }

      const coloringTime = performance.now() - start;

      // 创建新的 pointCloud 对象触发 React 更新，但复用同一个 colors 数组
      setPointCloud({ ...pointCloud, colors });
      setLastColoringTime(coloringTime);
      setSelectedIndices(new Uint32Array());
    },
    [pointCloud, selectedIndices]
  );

  return (
    <main className="h-screen w-full flex flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <h1 className="text-xl font-bold text-foreground">
          Point Cloud Viewer
        </h1>
        <div className="flex items-center gap-4">
          <FileUploader onUpload={handleFileUpload} isLoading={isLoading} />
        </div>
      </header>

      {pointCloud && (
        <Toolbar
          selectionMode={selectionMode}
          onModeChange={setSelectionMode}
          selectedCount={selectedIndices.length}
          onClearSelection={handleClearSelection}
          onColorSelection={handleColorSelection}
        />
      )}

      <div className="flex-1 relative">
        {!pointCloud ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center">
                <svg
                  className="w-12 h-12 text-muted-foreground"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">
                Upload a Point Cloud File
              </h2>
              <p className="text-muted-foreground text-sm max-w-sm">
                Drag and drop a PCD file or click the upload button to get
                started. Supports ASCII and binary PCD formats.
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
            <span>Selected: {selectedIndices.length.toLocaleString()}</span>
            <span>Workers: {workerCount}</span>
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
  );
}
