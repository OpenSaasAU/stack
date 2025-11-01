'use client'

import { useCallback, useState } from 'react'
import type { ImageMetadata } from '@opensaas/stack-storage'
import { Button } from '../../primitives/button.js'
import { Input } from '../../primitives/input.js'
import { Label } from '../../primitives/label.js'
import { Upload, X, Eye, ImageIcon } from 'lucide-react'
import Image from 'next/image'

export interface ImageFieldProps {
  name: string
  value: ImageMetadata | null
  onChange: (value: ImageMetadata | null) => void
  label?: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  helpText?: string
  placeholder?: string
  showPreview?: boolean
  previewSize?: number
  // Upload handling (must be provided by developer)
  onUpload?: (file: File) => Promise<ImageMetadata>
}

/**
 * Image upload field with preview, drag-and-drop, and transformation support
 *
 * This component provides the UI for image uploads with client-side preview.
 * Developers must implement the actual upload logic via the `onUpload` prop,
 * which should call their custom upload API route.
 */
export function ImageField({
  name,
  value,
  onChange,
  label,
  error,
  disabled,
  required,
  mode = 'edit',
  helpText,
  placeholder = 'Choose an image or drag and drop',
  showPreview = true,
  previewSize = 200,
  onUpload,
}: ImageFieldProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const handleFileSelect = useCallback(
    async (file: File) => {
      if (!onUpload) {
        console.error('ImageField: onUpload prop is required for image uploads')
        return
      }

      // Validate file is an image
      if (!file.type.startsWith('image/')) {
        setUploadError('Please select an image file')
        return
      }

      // Generate client-side preview
      if (showPreview) {
        const reader = new FileReader()
        reader.onload = (e) => {
          setPreviewUrl(e.target?.result as string)
        }
        reader.readAsDataURL(file)
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
        setPreviewUrl(null) // Clear client preview once uploaded
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed')
        setPreviewUrl(null)
      } finally {
        setIsUploading(false)
        setUploadProgress(0)
      }
    },
    [onUpload, onChange, showPreview]
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
    setPreviewUrl(null)
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
          <div className="space-y-2">
            <div className="relative inline-block">
              <Image
                src={value.url}
                alt={value.originalFilename}
                width={previewSize}
                height={previewSize}
                className="rounded-md object-cover border"
                style={{
                  maxWidth: `${previewSize}px`,
                  maxHeight: `${previewSize}px`,
                }}
              />
            </div>
            <div className="text-xs text-muted-foreground">
              {value.width} × {value.height}px • {formatFileSize(value.size)}
            </div>
            {value.transformations && Object.keys(value.transformations).length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium">Transformations:</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(value.transformations).map(([name, transform]) => {
                    const t = transform as { url: string; width: number; height: number; size: number }
                    return (
                      <Button
                        key={name}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(t.url, '_blank')}
                      >
                        {name} ({t.width}×{t.height})
                      </Button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No image uploaded</p>
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

      {value || previewUrl ? (
        // Image uploaded or preview available - show preview
        <div className="space-y-2">
          <div className="relative inline-block group">
            <Image
              src={previewUrl || value!.url}
              alt={value?.originalFilename || 'Preview'}
              width={previewSize}
              height={previewSize}
              className="rounded-md object-cover border"
              style={{
                maxWidth: `${previewSize}px`,
                maxHeight: `${previewSize}px`,
              }}
            />
            {value && (
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => window.open(value.url, '_blank')}
                >
                  <Eye className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleRemove}
                  disabled={disabled}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>

          {value && (
            <>
              <div className="text-xs text-muted-foreground">
                {value.originalFilename} • {value.width} × {value.height}px •{' '}
                {formatFileSize(value.size)}
              </div>

              {value.transformations && Object.keys(value.transformations).length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium">Transformations:</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(value.transformations).map(([name, transform]) => {
                      const t = transform as { url: string; width: number; height: number; size: number }
                      return (
                        <Button
                          key={name}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(t.url, '_blank')}
                        >
                          {name} ({t.width}×{t.height})
                        </Button>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {isUploading && (
            <div className="mt-2">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-xs text-center text-muted-foreground mt-1">
                Uploading... {uploadProgress}%
              </p>
            </div>
          )}
        </div>
      ) : (
        // No image - show upload area
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
              accept="image/*"
              onChange={handleInputChange}
              disabled={disabled || isUploading}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />

            <div className="flex flex-col items-center gap-2 text-center">
              {showPreview ? (
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              ) : (
                <Upload className="h-8 w-8 text-muted-foreground" />
              )}
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
