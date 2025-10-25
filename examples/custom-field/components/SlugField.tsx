'use client'

import { useState, useEffect } from 'react'
import { cn } from '@opensaas/stack-ui/lib/utils'

export interface SlugFieldProps {
  name: string
  value: string
  onChange: (value: string) => void
  label: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  sourceField?: string // Field to auto-generate slug from
}

/**
 * Custom slug field component with auto-generation
 * Demonstrates per-field component override
 */
export function SlugField({
  name,
  value,
  onChange,
  label,
  error,
  disabled,
  required,
  mode = 'edit',
}: SlugFieldProps) {
  const [isAutoMode, setIsAutoMode] = useState(true)

  // Auto-generate slug from title if in auto mode
  useEffect(() => {
    if (isAutoMode && !value) {
      // In a real app, you'd listen to the title field changes
      // For now, this is just a demo
    }
  }, [isAutoMode, value])

  const generateSlug = (text: string) => {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/--+/g, '-')
      .trim()
  }

  if (mode === 'read') {
    return (
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">{label}</label>
        <div className="flex items-center gap-2">
          <code className="text-sm bg-muted px-2 py-1 rounded">/{value || 'no-slug'}</code>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <label htmlFor={name} className="text-sm font-medium text-foreground flex items-center gap-1">
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">/</span>
        <input
          id={name}
          type="text"
          value={value || ''}
          onChange={(e) => {
            setIsAutoMode(false)
            onChange(generateSlug(e.target.value))
          }}
          placeholder="auto-generated-slug"
          disabled={disabled}
          className={cn(
            'flex-1 px-3 py-2 rounded-md border border-input font-mono text-sm',
            'bg-background text-foreground',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            error && 'border-destructive focus:ring-destructive',
            isAutoMode && 'bg-muted text-muted-foreground italic',
          )}
        />
        {isAutoMode && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">Auto</span>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        {isAutoMode
          ? 'Slug will be auto-generated from the title'
          : 'Manually set (only lowercase, numbers, and hyphens)'}
      </p>
    </div>
  )
}
