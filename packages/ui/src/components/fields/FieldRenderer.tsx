'use client'

import * as React from 'react'
import type { FieldConfig } from '@opensaas/stack-core'
import { getFieldComponent } from './registry.js'
import { formatFieldName } from '../../lib/utils.js'

export interface FieldRendererProps {
  fieldName: string
  fieldConfig: FieldConfig
  value: unknown
  onChange: (value: unknown) => void
  error?: string
  disabled?: boolean
  mode?: 'read' | 'edit'
  relationshipItems?: Array<{ id: string; label: string }>
  relationshipLoading?: boolean
}

/**
 * Internal component that receives the resolved Component
 */
function FieldRendererInner({
  Component,
  fieldName,
  fieldConfig,
  value,
  onChange,
  error,
  disabled,
  mode,
  relationshipItems,
  relationshipLoading,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}: FieldRendererProps & { Component: React.ComponentType<any> }) {
  const label = (fieldConfig as Record<string, unknown>).label || formatFieldName(fieldName)
  const isRequired =
    (fieldConfig as Record<string, unknown>).validation &&
    typeof (fieldConfig as Record<string, unknown>).validation === 'object' &&
    (fieldConfig as Record<string, unknown>).validation !== null &&
    'isRequired' in ((fieldConfig as Record<string, unknown>).validation as Record<string, unknown>)
      ? ((fieldConfig as Record<string, unknown>).validation as Record<string, unknown>).isRequired
      : false

  // Build props based on field type
  const baseProps = {
    name: fieldName,
    value,
    onChange,
    label,
    error,
    disabled,
    required: isRequired,
    mode,
  }

  // Add field-type-specific props
  const specificProps: Record<string, unknown> = {}

  if (fieldConfig.type === 'select' && 'options' in fieldConfig && fieldConfig.options) {
    specificProps.options = fieldConfig.options.map(
      (opt: string | { label: string; value: string }) =>
        typeof opt === 'string' ? { label: opt, value: opt } : opt,
    )
  }

  if (fieldConfig.type === 'password') {
    specificProps.showConfirm = mode === 'edit'
  }

  if (fieldConfig.type === 'relationship') {
    specificProps.items = relationshipItems
    specificProps.isLoading = relationshipLoading
    specificProps.many = (fieldConfig as Record<string, unknown>).many || false
  }

  // Pass through any UI options from fieldConfig.ui (excluding component and fieldType)
  if (fieldConfig.ui) {
    const { _component, _fieldType, ...uiOptions } = fieldConfig.ui
    Object.assign(specificProps, uiOptions)
  }

  const allProps = { ...baseProps, ...specificProps }
  return <Component {...allProps} />
}

/**
 * Factory component that renders the appropriate field type
 * based on the field configuration and component registry
 */
export function FieldRenderer(props: FieldRendererProps) {
  const { fieldName, fieldConfig, mode = 'edit' } = props

  const label = (fieldConfig as Record<string, unknown>).label || formatFieldName(fieldName)

  // Skip rendering ID and timestamp fields in forms
  if (mode === 'edit' && ['id', 'createdAt', 'updatedAt'].includes(fieldName)) {
    return null
  }

  // Get component from:
  // 1. Per-field component override (ui.component)
  // 2. Custom field type override (ui.fieldType) - uses global registry
  // 3. Default field type (fieldConfig.type) - uses global registry
  const Component =
    fieldConfig.ui?.component ||
    (fieldConfig.ui?.fieldType
      ? getFieldComponent(fieldConfig.ui.fieldType)
      : getFieldComponent(fieldConfig.type))

  if (!Component) {
    console.warn(`No component registered for field type: ${fieldConfig.type}`)
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium text-muted-foreground">{String(label)}</label>
        <p className="text-sm text-muted-foreground">Unsupported field type: {fieldConfig.type}</p>
      </div>
    )
  }

  return <FieldRendererInner {...props} Component={Component} />
}
