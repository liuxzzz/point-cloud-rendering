"use client"

import { Button } from "@/components/ui/button"
import { MousePointer2, Lasso, Trash2, Palette } from "lucide-react"
import type { SelectionMode } from "@/lib/types"

interface ToolbarProps {
  selectionMode: SelectionMode
  onModeChange: (mode: SelectionMode) => void
  selectedCount: number
  onClearSelection: () => void
  onColorSelection: (color: string) => void
}

export function Toolbar({
  selectionMode,
  onModeChange,
  selectedCount,
  onClearSelection,
  onColorSelection,
}: ToolbarProps) {

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

      <Button
        variant="outline"
        size="sm"
        disabled={selectedCount === 0}
        onClick={() => onColorSelection("#22c55e")}
        className="gap-2 bg-green-500/10 hover:bg-green-500/20"
      >
        <Palette className="w-4 h-4" />
        上色
      </Button>

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
