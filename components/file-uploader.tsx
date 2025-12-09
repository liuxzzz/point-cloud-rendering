"use client"

import type React from "react"

import { useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Upload, Loader2 } from "lucide-react"

interface FileUploaderProps {
  onUpload: (file: File) => void
  isLoading: boolean
}

export function FileUploader({ onUpload, isLoading }: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClick = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        onUpload(file)
      }
      // Reset input
      if (inputRef.current) {
        inputRef.current.value = ""
      }
    },
    [onUpload],
  )

  return (
    <>
      <input ref={inputRef} type="file" accept=".pcd" onChange={handleChange} className="hidden" />
      <Button onClick={handleClick} disabled={isLoading}>
        {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
        {isLoading ? "Loading..." : "Upload PCD"}
      </Button>
    </>
  )
}
