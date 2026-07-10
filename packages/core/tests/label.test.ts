import { describe, it, expect } from 'vitest'
import { getLabelFieldName, getItemLabel } from '../src/config/label.js'
import type { ListConfig, TypeInfo } from '../src/config/types.js'

function makeListConfig(
  fields: ListConfig<TypeInfo>['fields'],
  labelField?: string,
): ListConfig<TypeInfo> {
  return {
    fields,
    ui: labelField !== undefined ? { labelField } : undefined,
  }
}

describe('label seam', () => {
  describe('getLabelFieldName', () => {
    it('uses the configured ui.labelField when it references a scalar field', () => {
      const listConfig = makeListConfig(
        { name: { type: 'text' }, email: { type: 'text' } },
        'email',
      )
      expect(getLabelFieldName(listConfig)).toBe('email')
    })

    it('falls back to "name" when no ui.labelField is configured', () => {
      const listConfig = makeListConfig({ name: { type: 'text' }, title: { type: 'text' } })
      expect(getLabelFieldName(listConfig)).toBe('name')
    })

    it('falls back to "title" when "name" is not declared', () => {
      const listConfig = makeListConfig({ title: { type: 'text' }, body: { type: 'text' } })
      expect(getLabelFieldName(listConfig)).toBe('title')
    })

    it('falls back to "id" when neither "name" nor "title" is declared', () => {
      const listConfig = makeListConfig({ body: { type: 'text' } })
      expect(getLabelFieldName(listConfig)).toBe('id')
    })

    it('throws when ui.labelField references a field not declared on the list', () => {
      const listConfig = makeListConfig({ name: { type: 'text' } }, 'nickname')
      expect(() => getLabelFieldName(listConfig)).toThrow(
        /ui.labelField "nickname" does not reference a field declared on this list/,
      )
    })

    it('throws when ui.labelField references a relationship field', () => {
      const listConfig = makeListConfig(
        { name: { type: 'text' }, author: { type: 'relationship' } },
        'author',
      )
      expect(() => getLabelFieldName(listConfig)).toThrow(
        /ui.labelField "author" must reference a scalar field, not a relationship/,
      )
    })
  })

  describe('getItemLabel', () => {
    it('reads the resolved label field off the row', () => {
      const listConfig = makeListConfig({ name: { type: 'text' } })
      expect(getItemLabel(listConfig, { id: '1', name: 'Ada Lovelace' })).toBe('Ada Lovelace')
    })

    it('falls back to id when the resolved field is missing from the row', () => {
      const listConfig = makeListConfig({ name: { type: 'text' } })
      // e.g. stripped by field-level access
      expect(getItemLabel(listConfig, { id: 'row-1' })).toBe('row-1')
    })

    it('falls back to id when the resolved field is null on the row', () => {
      const listConfig = makeListConfig({ name: { type: 'text' } })
      expect(getItemLabel(listConfig, { id: 'row-2', name: null })).toBe('row-2')
    })

    it('respects a configured ui.labelField', () => {
      const listConfig = makeListConfig(
        { name: { type: 'text' }, email: { type: 'text' } },
        'email',
      )
      expect(getItemLabel(listConfig, { id: '1', name: 'Ada', email: 'ada@example.com' })).toBe(
        'ada@example.com',
      )
    })
  })

  describe('projection⇄render agreement', () => {
    const cases: Array<{
      description: string
      labelField?: string
      fields: ListConfig<TypeInfo>['fields']
      row: Record<string, unknown>
    }> = [
      {
        description: 'configured labelField, field present on row',
        labelField: 'email',
        fields: { name: { type: 'text' }, email: { type: 'text' } },
        row: { id: '1', name: 'Ada', email: 'ada@example.com' },
      },
      {
        description: 'no labelField, name present',
        fields: { name: { type: 'text' }, title: { type: 'text' } },
        row: { id: '2', name: 'Alan', title: 'Dr' },
      },
      {
        description: 'no labelField, only title present',
        fields: { title: { type: 'text' } },
        row: { id: '3', title: 'Untitled Post' },
      },
      {
        description: 'no labelField, no name/title, falls back to id',
        fields: { body: { type: 'text' } },
        row: { id: '4', body: 'hello' },
      },
      {
        description: 'configured labelField, field stripped from row by access control',
        labelField: 'email',
        fields: { name: { type: 'text' }, email: { type: 'text' } },
        row: { id: '5', name: 'Grace' },
      },
    ]

    it.each(cases)(
      'the field getLabelFieldName resolves is the field getItemLabel reads: $description',
      ({ labelField, fields, row }) => {
        const listConfig = makeListConfig(fields, labelField)
        const resolvedFieldName = getLabelFieldName(listConfig)
        const expectedLabel = Object.prototype.hasOwnProperty.call(row, resolvedFieldName)
          ? (row[resolvedFieldName] ?? row.id)
          : row.id

        expect(getItemLabel(listConfig, row)).toBe(String(expectedLabel))
      },
    )
  })
})
