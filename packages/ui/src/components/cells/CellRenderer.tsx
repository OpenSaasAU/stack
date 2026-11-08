'use client'

import * as React from 'react'
import {
  anchorFreeCellComponents,
  getCellComponent,
  type CellComponent,
  type CellComponentProps,
} from './registry.js'
import type { SerializableFieldConfig } from '../../lib/serializeFieldConfig.js'
import { TextCell } from './TextCell.js'

function resolveCellComponent(field: SerializableFieldConfig): CellComponent {
  return (
    field.ui?.cell ||
    (field.ui?.fieldType ? getCellComponent(field.ui.fieldType) : getCellComponent(field.type)) ||
    TextCell
  )
}

/**
 * Whether `field` renders through one of the admin UI's own anchor-free Cells,
 * rather than one that renders its own link (a relationship), a `ui.cell`
 * override or a Cell a package registered, whose markup the caller cannot know.
 */
export function rendersAnchorFreeCell(field: SerializableFieldConfig): boolean {
  return anchorFreeCellComponents.has(resolveCellComponent(field))
}

function CellRendererInner({
  Component,
  ...props
}: CellComponentProps & { Component: CellComponent }) {
  return <Component {...props} />
}

/**
 * Resolves and renders the Cell for one field value, mirroring `FieldRenderer`'s
 * form-component resolution priority. No switch on field type here, matching
 * the field-builder self-containment rule.
 */
export function CellRenderer(props: CellComponentProps) {
  return <CellRendererInner {...props} Component={resolveCellComponent(props.field)} />
}
