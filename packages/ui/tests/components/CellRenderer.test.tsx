import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CellRenderer } from '../../src/components/cells/CellRenderer.js'
import {
  registerCellComponent,
  type CellComponentProps,
} from '../../src/components/cells/registry.js'
import type { SerializableFieldConfig } from '../../src/lib/serializeFieldConfig.js'

/**
 * The cell registry must resolve a Cell through the SAME priority chain as the
 * form-field registry: per-field override → custom type registry → field-type
 * registry → plain-text fallback.
 */
describe('CellRenderer resolution priority', () => {
  function OverrideCell({ value }: CellComponentProps) {
    return <span>override:{String(value)}</span>
  }

  function CustomTypeCell({ value }: CellComponentProps) {
    return <span>custom-type:{String(value)}</span>
  }

  // Register a Cell for a made-up custom type used via `ui.fieldType`.
  registerCellComponent('cellTestCustom', CustomTypeCell)

  it('1. per-field override (ui.cell) wins over every registry', () => {
    const field: SerializableFieldConfig = {
      // Even though `select` and the custom type both resolve, the override wins.
      type: 'select',
      ui: { cell: OverrideCell, fieldType: 'cellTestCustom' },
    }
    render(<CellRenderer value="X" field={field} fieldName="f" />)
    expect(screen.getByText('override:X')).toBeInTheDocument()
  })

  it('2. custom type registry (ui.fieldType) resolves next', () => {
    const field: SerializableFieldConfig = {
      type: 'select',
      ui: { fieldType: 'cellTestCustom' },
    }
    render(<CellRenderer value="Y" field={field} fieldName="f" />)
    expect(screen.getByText('custom-type:Y')).toBeInTheDocument()
  })

  it('3. field-type registry resolves the default Cell', () => {
    const field: SerializableFieldConfig = {
      type: 'select',
      options: [{ label: 'Published', value: 'published' }],
    }
    render(<CellRenderer value="published" field={field} fieldName="status" />)
    // The select default Cell renders a Badge showing the option label.
    const badge = screen.getByText('Published')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('data-slot', 'cell-select')
  })

  it('4. unknown / third-party types without a registered Cell fall back to plain text', () => {
    const field: SerializableFieldConfig = { type: 'someUnregisteredThirdPartyType' }
    render(<CellRenderer value="raw value" field={field} fieldName="f" />)
    const cell = screen.getByText('raw value')
    expect(cell).toBeInTheDocument()
    expect(cell).toHaveAttribute('data-slot', 'cell-text')
  })
})
