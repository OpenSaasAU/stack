'use client'

import React, { useCallback, useState } from 'react'
import type { FileMetadata } from '@opensaas/stack-storage'
import { Button } from '../../primitives/button.js'
import { Input } from '../../primitives/input.js'
import { Label } from '../../primitives/label.js'
import { Upload, X, File, Check } from 'lucide-react'

export interface FileFieldProps {
  name: string
  value: File | FileMetadata | null
  onChange: (value: File | FileMetadata | null) => void
  label?: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  helpText?: string
  placeholder?: string
}

/**
 * File upload field with drag-and-drop support
 *
 * Stores File objects in form state. The actual upload happens server-side
 * during form submission via field hooks.
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
}: FileFieldProps) {
  const [isDragOver, setIsDragOver] = useState(false)

  const handleFileSelect = useCallback(
    (file: File) => {
      // Store File object in form state
      // Upload will happen server-side during form submission
      onChange(file)
    },
    [onChange],
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
  }, [onChange])

  // Determine if value is File or FileMetadata
  // Use duck typing instead of instanceof to support SSR
  const isFile = value && typeof value === 'object' && 'arrayBuffer' in value && typeof (value as {arrayBuffer?: unknown}).arrayBuffer === 'function'
  const isFileMetadata = value && !isFile && typeof value === 'object' && 'url' in value

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
        {isFileMetadata ? (
          <div className="flex items-center gap-2 p-3 border rounded-md bg-muted">
            <File className="h-4 w-4" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {(value as FileMetadata).originalFilename}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatFileSize((value as FileMetadata).size)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => window.open((value as FileMetadata).url, '_blank')}
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

      {isFile || isFileMetadata ? (
        // File selected/uploaded - show file info
        <div className="flex items-center gap-2 p-3 border rounded-md">
          <Check className="h-4 w-4 text-green-600" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {isFile ? (value as File).name : (value as FileMetadata).originalFilename}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatFileSize(isFile ? (value as File).size : (value as FileMetadata).size)}
              {isFileMetadata && ` • ${(value as FileMetadata).mimeType}`}
              {isFile && ' • Will upload on save'}
            </p>
          </div>
          {isFileMetadata && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => window.open((value as FileMetadata).url, '_blank')}
            >
              View
            </Button>
          )}
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
              disabled={disabled}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />

            <div className="flex flex-col items-center gap-2 text-center">
              <Upload className="h-8 w-8 text-muted-foreground" />
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
