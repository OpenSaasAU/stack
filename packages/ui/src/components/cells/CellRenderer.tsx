'use client'

import * as React from 'react'
import { getCellComponent, type CellComponent, type CellComponentProps } from './registry.js'
import { TextCell } from './TextCell.js'

/**
 * Internal component that renders the already-resolved Cell. Resolving in the
 * outer factory and rendering here (Cell arrives as a prop) mirrors
 * `FieldRenderer`, keeping the resolved component out of this scope's render.
 */
function CellRendererInner({
  Component,
  ...props
}: CellComponentProps & { Component: CellComponent }) {
  return <Component {...props} />
}

/**
 * Resolves and renders the Cell for one field value, mirroring `FieldRenderer`'s
 * form-component resolution priority exactly:
 *
 * 1. `field.ui.cell` — per-field override (highest priority)
 * 2. `field.ui.fieldType` — custom type lookup in the cell registry
 * 3. `field.type` — default field-type lookup in the cell registry
 * 4. {@link TextCell} — plain-text fallback (unknown/third-party types)
 *
 * The resolution delegates to each field type's registered Cell — there is no
 * switch on field type here, matching the field-builder self-containment rule.
 */
export function CellRenderer(props: CellComponentProps) {
  const { field } = props

  const Component: CellComponent =
    field.ui?.cell ||
    (field.ui?.fieldType ? getCellComponent(field.ui.fieldType) : getCellComponent(field.type)) ||
    TextCell

  return <CellRendererInner {...props} Component={Component} />
}
