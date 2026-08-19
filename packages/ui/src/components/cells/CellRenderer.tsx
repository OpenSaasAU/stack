'use client'

import * as React from 'react'
import { getCellComponent, type CellComponent, type CellComponentProps } from './registry.js'
import { TextCell } from './TextCell.js'

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
  const { field } = props

  const Component: CellComponent =
    field.ui?.cell ||
    (field.ui?.fieldType ? getCellComponent(field.ui.fieldType) : getCellComponent(field.type)) ||
    TextCell

  return <CellRendererInner {...props} Component={Component} />
}
