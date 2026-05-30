'use client'

import * as React from 'react'
import { getFieldComponent } from './registry.js'
import { formatFieldName } from '../../lib/utils.js'
import { getUrlKey } from '@opensaas/stack-core'
import type { SerializableFieldConfig } from '../../lib/serializeFieldConfig.js'

export interface FieldRendererProps {
  fieldName: string
  fieldConfig: SerializableFieldConfig
  value: unknown
  onChange: (value: unknown) => void
  error?: string
  disabled?: boolean
  mode?: 'read' | 'edit'
  relationshipItems?: Array<{ id: string; label: string }>
  relationshipLoading?: boolean
  basePath?: string
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
  basePath,
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

  // Derive field-type-specific props from data-presence checks — no branching on fieldConfig.type.
  const specificProps: Record<string, unknown> = buildFallbackUIProps(
    fieldConfig,
    relationshipItems,
    relationshipLoading,
    basePath,
  )

  // Pass through any UI options from fieldConfig.ui (excluding component and fieldType)
  if (fieldConfig.ui) {
    const { component: _component, fieldType: _fieldType, ...uiOptions } = fieldConfig.ui
    Object.assign(specificProps, uiOptions)
  }

  const allProps = { ...baseProps, ...specificProps }
  return <Component {...allProps} />
}

/**
 * Derive field-specific UI props from the serialised field config using
 * data-presence checks rather than `fieldConfig.type` comparisons.
 */
function buildFallbackUIProps(
  fieldConfig: SerializableFieldConfig,
  relationshipItems: Array<{ id: string; label: string }> | undefined,
  relationshipLoading: boolean | undefined,
  basePath: string | undefined,
): Record<string, unknown> {
  const props: Record<string, unknown> = {}

  // Select options — only present on select fields
  if (fieldConfig.options) {
    props.options = fieldConfig.options
  }

  // Relationship props — only present on relationship fields
  if (fieldConfig.ref) {
    const [relatedListName] = fieldConfig.ref.split('.')
    props.relatedListKey = getUrlKey(relatedListName ?? '')
    props.many = fieldConfig.many || false
    props.items = relationshipItems
    props.isLoading = relationshipLoading
    props.basePath = basePath
  }

  return props
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
