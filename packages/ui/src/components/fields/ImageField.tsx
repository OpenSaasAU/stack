'use client'

import React, { useCallback, useState } from 'react'
import type { ImageMetadata } from '@opensaas/stack-storage'
import { Button } from '../../primitives/button.js'
import { Input } from '../../primitives/input.js'
import { Label } from '../../primitives/label.js'
import { Upload, X, Eye, ImageIcon } from 'lucide-react'
import Image from 'next/image'

export interface ImageFieldProps {
  name: string
  value: File | ImageMetadata | null
  onChange: (value: File | ImageMetadata | null) => void
  label?: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  helpText?: string
  placeholder?: string
  showPreview?: boolean
  previewSize?: number
}

/**
 * Image upload field with preview, drag-and-drop, and transformation support
 *
 * Stores File objects in form state with client-side preview. The actual upload
 * happens server-side during form submission via field hooks.
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
}: ImageFieldProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const handleFileSelect = useCallback(
    (file: File) => {
      // Validate file is an image
      if (!file.type.startsWith('image/')) {
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

      // Store File object in form state
      // Upload will happen server-side during form submission
      onChange(file)
    },
    [onChange, showPreview],
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
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)

      if (disabled || mode === 'read') return

      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) {
        handleFileSelect(files[0])
      }
    },
    [disabled, mode, handleFileSelect],
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || [])
      if (files.length > 0) {
        handleFileSelect(files[0])
      }
    },
    [handleFileSelect],
  )

  const handleRemove = useCallback(() => {
    onChange(null)
    setPreviewUrl(null)
  }, [onChange])

  // Determine if value is File or ImageMetadata
  // Use duck typing instead of instanceof to support SSR
  const isFile = value && typeof value === 'object' && 'arrayBuffer' in value && typeof (value as {arrayBuffer?: unknown}).arrayBuffer === 'function'
  const isImageMetadata = value && !isFile && typeof value === 'object' && 'url' in value

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
        {isImageMetadata ? (
          <div className="space-y-2">
            <div className="relative inline-block">
              <Image
                src={(value as ImageMetadata).url}
                alt={(value as ImageMetadata).originalFilename}
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
              {(value as ImageMetadata).width} × {(value as ImageMetadata).height}px •{' '}
              {formatFileSize((value as ImageMetadata).size)}
            </div>
            {(value as ImageMetadata).transformations &&
              Object.keys((value as ImageMetadata).transformations!).length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium">Transformations:</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries((value as ImageMetadata).transformations!).map(
                      ([name, transform]) => {
                        const t = transform as {
                          url: string
                          width: number
                          height: number
                          size: number
                        }
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
                      },
                    )}
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

      {isFile || isImageMetadata || previewUrl ? (
        // Image selected/uploaded or preview available - show preview
        <div className="space-y-2">
          <div className="relative inline-block group">
            <Image
              src={previewUrl || (isImageMetadata ? (value as ImageMetadata).url : '')}
              alt={isImageMetadata ? (value as ImageMetadata).originalFilename : 'Preview'}
              width={previewSize}
              height={previewSize}
              className="rounded-md object-cover border"
              style={{
                maxWidth: `${previewSize}px`,
                maxHeight: `${previewSize}px`,
              }}
            />
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {isImageMetadata && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => window.open((value as ImageMetadata).url, '_blank')}
                >
                  <Eye className="h-3 w-3" />
                </Button>
              )}
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
          </div>

          {isFile && (
            <div className="text-xs text-muted-foreground">
              {(value as File).name} • {formatFileSize((value as File).size)} • Will upload on save
            </div>
          )}

          {isImageMetadata && (
            <>
              <div className="text-xs text-muted-foreground">
                {(value as ImageMetadata).originalFilename} • {(value as ImageMetadata).width} ×{' '}
                {(value as ImageMetadata).height}px •{' '}
                {formatFileSize((value as ImageMetadata).size)}
              </div>

              {(value as ImageMetadata).transformations &&
                Object.keys((value as ImageMetadata).transformations!).length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium">Transformations:</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries((value as ImageMetadata).transformations!).map(
                        ([name, transform]) => {
                          const t = transform as {
                            url: string
                            width: number
                            height: number
                            size: number
                          }
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
                        },
                      )}
                    </div>
                  </div>
                )}
            </>
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
              disabled={disabled}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />

            <div className="flex flex-col items-center gap-2 text-center">
              {showPreview ? (
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              ) : (
                <Upload className="h-8 w-8 text-muted-foreground" />
              )}
              <p className="text-sm font-medium">{placeholder}</p>
              {helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
            </div>
          </div>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
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
