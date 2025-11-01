'use client'

import { useCallback, useState } from 'react'
import type { FileMetadata } from '@opensaas/stack-storage'
import { Button } from '../../primitives/button.js'
import { Input } from '../../primitives/input.js'
import { Label } from '../../primitives/label.js'
import { Upload, X, File, Check } from 'lucide-react'

export interface FileFieldProps {
  name: string
  value: FileMetadata | null
  onChange: (value: FileMetadata | null) => void
  label?: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  helpText?: string
  placeholder?: string
  // Upload handling (must be provided by developer)
  onUpload?: (file: File) => Promise<FileMetadata>
}

/**
 * File upload field with drag-and-drop support
 *
 * This component provides the UI for file uploads. Developers must implement
 * the actual upload logic via the `onUpload` prop, which should call their
 * custom upload API route.
 */
export function FileField({
  name,
  value,
  onChange,
  label,
  error,
  disabled,
  required,
  mode = 'edit',
  helpText,
  placeholder = 'Choose a file or drag and drop',
  onUpload,
}: FileFieldProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleFileSelect = useCallback(
    async (file: File) => {
      if (!onUpload) {
        console.error('FileField: onUpload prop is required for file uploads')
        return
      }

      setIsUploading(true)
      setUploadError(null)
      setUploadProgress(0)

      try {
        // Simulate progress (real progress would need server support)
        const progressInterval = setInterval(() => {
          setUploadProgress((prev) => Math.min(prev + 10, 90))
        }, 100)

        const metadata = await onUpload(file)

        clearInterval(progressInterval)
        setUploadProgress(100)

        onChange(metadata)
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed')
      } finally {
        setIsUploading(false)
        setUploadProgress(0)
      }
    },
    [onUpload, onChange]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)

      if (disabled || mode === 'read') return

      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) {
        await handleFileSelect(files[0])
      }
    },
    [disabled, mode, handleFileSelect]
  )

  const handleInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || [])
      if (files.length > 0) {
        await handleFileSelect(files[0])
      }
    },
    [handleFileSelect]
  )

  const handleRemove = useCallback(() => {
    onChange(null)
  }, [onChange])

  // Read-only mode
  if (mode === 'read') {
    return (
      <div className="space-y-2">
        {label && (
          <Label htmlFor={name}>
            {label}
            {required && <span className="text-destructive ml-1">*</span>}
          </Label>
        )}
        {value ? (
          <div className="flex items-center gap-2 p-3 border rounded-md bg-muted">
            <File className="h-4 w-4" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{value.originalFilename}</p>
              <p className="text-xs text-muted-foreground">
                {formatFileSize(value.size)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => window.open(value.url, '_blank')}
            >
              Download
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No file uploaded</p>
        )}
      </div>
    )
  }

  // Edit mode
  return (
    <div className="space-y-2">
      {label && (
        <Label htmlFor={name}>
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
      )}

      {value ? (
        // File uploaded - show file info
        <div className="flex items-center gap-2 p-3 border rounded-md">
          <Check className="h-4 w-4 text-green-600" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{value.originalFilename}</p>
            <p className="text-xs text-muted-foreground">
              {formatFileSize(value.size)} • {value.mimeType}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.open(value.url, '_blank')}
          >
            View
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={disabled}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        // No file - show upload area
        <>
          <div
            className={`
              relative border-2 border-dashed rounded-md p-6
              transition-colors cursor-pointer
              ${isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary hover:bg-primary/5'}
            `}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Input
              id={name}
              type="file"
              onChange={handleInputChange}
              disabled={disabled || isUploading}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />

            <div className="flex flex-col items-center gap-2 text-center">
              <Upload className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">{placeholder}</p>
              {helpText && (
                <p className="text-xs text-muted-foreground">{helpText}</p>
              )}
            </div>

            {isUploading && (
              <div className="mt-4">
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-xs text-center text-muted-foreground mt-2">
                  Uploading... {uploadProgress}%
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {(error || uploadError) && (
        <p className="text-sm text-destructive">{error || uploadError}</p>
      )}
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`
}
