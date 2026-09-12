import { describe, it, expect } from 'vitest'
import { getFieldComponent, getCellComponent } from '@opensaas/stack-ui'
import { TiptapField } from '../src/components/TiptapField.js'
import { TiptapCell } from '../src/components/TiptapCell.js'
import '../src/components/register.js'

describe('richText registration', () => {
  it('registers the form component', () => {
    expect(getFieldComponent('richText')).toBe(TiptapField)
  })

  it('registers the list-table cell', () => {
    expect(getCellComponent('richText')).toBe(TiptapCell)
  })
})
