"use client"

import type React from "react"

import { useRef, useEffect, useState, useCallback } from "react"
import type { LassoPoint } from "@/lib/types"

interface LassoOverlayProps {
  onPathUpdate: (path: LassoPoint[]) => void
  onComplete: (path: LassoPoint[]) => void
}

export function LassoOverlay({ onPathUpdate, onComplete }: LassoOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const pathRef = useRef<LassoPoint[]>([])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const path = pathRef.current
    if (path.length < 2) return

    ctx.beginPath()
    ctx.moveTo(path[0].x, path[0].y)

    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y)
    }

    // Close the path
    ctx.closePath()

    // Fill with semi-transparent color
    ctx.fillStyle = "rgba(59, 130, 246, 0.2)"
    ctx.fill()

    // Draw stroke
    ctx.strokeStyle = "#3b82f6"
    ctx.lineWidth = 2
    ctx.setLineDash([5, 5])
    ctx.stroke()
  }, [])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsDrawing(true)
      pathRef.current = [{ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }]
      onPathUpdate(pathRef.current)
    },
    [onPathUpdate],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDrawing) return

      const newPoint = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }
      pathRef.current = [...pathRef.current, newPoint]
      onPathUpdate(pathRef.current)
      draw()
    },
    [isDrawing, onPathUpdate, draw],
  )

  const handleMouseUp = useCallback(() => {
    if (!isDrawing) return

    setIsDrawing(false)
    onComplete(pathRef.current)
    pathRef.current = []

    // Clear canvas
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
    }
  }, [isDrawing, onComplete])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleResize = () => {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }

    handleResize()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    />
  )
}
