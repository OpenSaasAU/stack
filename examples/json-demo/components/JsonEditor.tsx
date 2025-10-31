'use client'

import { useState, useMemo } from 'react'
import { JsonView, allExpanded, defaultStyles } from 'react-json-view-lite'
import 'react-json-view-lite/dist/index.css'
import { Label } from '@opensaas/stack-ui/primitives'
import { cn } from '@opensaas/stack-ui/lib/utils'
import { Textarea } from '@opensaas/stack-ui/primitives'

export interface JsonEditorProps {
  name: string
  value: unknown
  onChange: (value: unknown) => void
  label: string
  placeholder?: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  rows?: number
  formatted?: boolean
}

export function JsonEditor({
  name,
  value,
  onChange,
  label,
  placeholder = 'Enter JSON data...',
  error,
  disabled,
  required,
  mode = 'edit',
  rows = 12,
}: JsonEditorProps) {
  // Track the string being edited separately from the prop value
  const [editingValue, setEditingValue] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | undefined>()

  // Compute the display value - either what's being edited or the prop value
  const displayValue = useMemo(() => {
    if (editingValue !== null) {
      return editingValue
    }
    try {
      return value !== undefined && value !== null ? JSON.stringify(value, null, 2) : ''
    } catch {
      return ''
    }
  }, [value, editingValue])

  const handleChange = (text: string) => {
    setEditingValue(text)

    // Try to parse and update value
    if (text.trim() === '') {
      onChange(undefined)
      setParseError(undefined)
      return
    }

    try {
      const parsed = JSON.parse(text)
      onChange(parsed)
      setParseError(undefined)
    } catch (e) {
      if (e instanceof Error) {
        setParseError(`Invalid JSON: ${e.message}`)
      } else {
        setParseError('Invalid JSON')
      }
    }
  }

  const handleBlur = () => {
    // Clear editing state on blur
    setEditingValue(null)
  }

  // Parse current value for tree view
  const parsedValue = useMemo(() => {
    try {
      if (value !== undefined && value !== null) {
        // Ensure we return an object or array for JsonView
        return typeof value === 'object' ? value : { value }
      }
      return null
    } catch {
      return null
    }
  }, [value])

  if (mode === 'read') {
    return (
      <div className="space-y-2">
        <Label className="text-muted-foreground">{label}</Label>
        <div className="border rounded-md p-4 bg-muted/30">
          {parsedValue !== null && (typeof parsedValue === 'object' || Array.isArray(parsedValue)) ? (
            <JsonView
              data={parsedValue as object | unknown[]}
              shouldExpandNode={allExpanded}
              style={{
                ...defaultStyles,
                container: 'bg-transparent font-mono text-sm',
                label: 'text-foreground font-semibold',
                nullValue: 'text-muted-foreground',
                undefinedValue: 'text-muted-foreground',
                stringValue: 'text-green-600 dark:text-green-400',
                booleanValue: 'text-blue-600 dark:text-blue-400',
                numberValue: 'text-purple-600 dark:text-purple-400',
                otherValue: 'text-muted-foreground',
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">-</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>

      <div className="grid grid-cols-2 gap-4">
        {/* Edit panel */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Editor</div>
          <Textarea
            id={name}
            name={name}
            value={displayValue}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={handleBlur}
            placeholder={placeholder}
            disabled={disabled}
            required={required}
            rows={rows}
            className={cn(
              'font-mono text-sm resize-none',
              (error || parseError) && 'border-destructive',
            )}
          />
          {parseError && <p className="text-xs text-amber-600 dark:text-amber-500">{parseError}</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        {/* Preview panel */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Preview</div>
          <div
            className={cn(
              'border rounded-md p-3 bg-muted/30 overflow-auto',
              'min-h-[200px] max-h-[400px]',
            )}
          >
            {parsedValue !== null && !parseError && (typeof parsedValue === 'object' || Array.isArray(parsedValue)) ? (
              <JsonView
                data={parsedValue as object | unknown[]}
                shouldExpandNode={allExpanded}
                style={{
                  ...defaultStyles,
                  container: 'bg-transparent font-mono text-xs',
                  label: 'text-foreground font-semibold',
                  nullValue: 'text-muted-foreground',
                  undefinedValue: 'text-muted-foreground',
                  stringValue: 'text-green-600 dark:text-green-400',
                  booleanValue: 'text-blue-600 dark:text-blue-400',
                  numberValue: 'text-purple-600 dark:text-purple-400',
                  otherValue: 'text-muted-foreground',
                }}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                {parseError ? 'Invalid JSON' : 'Enter valid JSON to see preview'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
