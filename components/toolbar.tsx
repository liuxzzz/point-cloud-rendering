"use client"

import { Button } from "@/components/ui/button"
import { MousePointer2, Lasso, Trash2, Palette } from "lucide-react"
import type { SelectionMode } from "@/lib/types"
import { useState } from "react"

interface ToolbarProps {
  selectionMode: SelectionMode
  onModeChange: (mode: SelectionMode) => void
  selectedCount: number
  onClearSelection: () => void
  onColorSelection: (color: string) => void
}

const COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
]

export function Toolbar({
  selectionMode,
  onModeChange,
  selectedCount,
  onClearSelection,
  onColorSelection,
}: ToolbarProps) {
  const [showColors, setShowColors] = useState(false)

  return (
    <div className="flex items-center gap-2 px-6 py-3 border-b border-border bg-card">
      <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
        <Button
          variant={selectionMode === "orbit" ? "default" : "ghost"}
          size="sm"
          onClick={() => onModeChange("orbit")}
          className="gap-2"
        >
          <MousePointer2 className="w-4 h-4" />
          Orbit
        </Button>
        <Button
          variant={selectionMode === "lasso" ? "default" : "ghost"}
          size="sm"
          onClick={() => onModeChange("lasso")}
          className="gap-2"
        >
          <Lasso className="w-4 h-4" />
          Lasso
        </Button>
      </div>

      <div className="w-px h-6 bg-border mx-2" />

      <div className="relative">
        <Button
          variant="outline"
          size="sm"
          disabled={selectedCount === 0}
          onClick={() => setShowColors(!showColors)}
          className="gap-2"
        >
          <Palette className="w-4 h-4" />
          Color
        </Button>

        {showColors && (
          <div className="absolute top-full left-0 mt-2 p-2 bg-card border border-border rounded-lg shadow-lg z-50">
            <div className="grid grid-cols-4 gap-2">
              {COLORS.map((color) => (
                <button
                  key={color}
                  className="w-8 h-8 rounded-md border-2 border-transparent hover:border-foreground transition-colors"
                  style={{ backgroundColor: color }}
                  onClick={() => {
                    onColorSelection(color)
                    setShowColors(false)
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        disabled={selectedCount === 0}
        onClick={onClearSelection}
        className="gap-2 bg-transparent"
      >
        <Trash2 className="w-4 h-4" />
        Clear
      </Button>

      {selectedCount > 0 && (
        <span className="ml-2 text-sm text-muted-foreground">{selectedCount.toLocaleString()} points selected</span>
      )}
    </div>
  )
}
