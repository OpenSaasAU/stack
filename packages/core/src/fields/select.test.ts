import { describe, it, expect } from 'vitest'
import { select } from './index.js'
import type { ContractColumnDescriptor, OpenSaasConfig } from '../config/types.js'

const config: OpenSaasConfig = { db: { provider: 'postgresql' }, lists: {} }

function columnOf(
  field: ReturnType<typeof select>,
  fieldName: string,
  listName = 'Post',
): ContractColumnDescriptor {
  const descriptor = field.getContractField?.(fieldName, listName, config)
  if (descriptor?.kind !== 'column') {
    throw new Error(`select("${fieldName}") did not describe a single column`)
  }
  const { kind: _kind, ...column } = descriptor
  return column
}

describe('select field builder', () => {
  describe('string type (default)', () => {
    it('should throw when no options are provided', () => {
      expect(() => select({ options: [] })).toThrow('Select field must have at least one option')
    })

    it('should back a default select with a text column and no enum', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
      })

      const column = columnOf(field, 'status')
      expect(column.type).toEqual({ pack: 'pg', type: 'text' })
      expect(column.enum).toBeUndefined()
    })

    it('should be nullable for an optional string select', () => {
      const field = select({ options: [{ label: 'Draft', value: 'draft' }] })

      expect(columnOf(field, 'status').nullable).toBe(true)
    })

    it('should not be nullable for a required string select', () => {
      const field = select({
        options: [{ label: 'Draft', value: 'draft' }],
        validation: { isRequired: true },
      })

      expect(columnOf(field, 'status').nullable).toBe(false)
    })

    it('should carry the default value as a literal for a string select', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        defaultValue: 'draft',
      })

      expect(columnOf(field, 'status').default).toEqual({ kind: 'literal', value: 'draft' })
    })

    it('should be non-nullable for an optional string select with a default', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        defaultValue: 'draft',
      })

      const column = columnOf(field, 'status')
      // Default behaviour: a present default makes the column NOT NULL
      expect(column.default).toEqual({ kind: 'literal', value: 'draft' })
      expect(column.nullable).toBe(false)
    })

    it('should force nullable with db.isNullable even when a default is present (string)', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        defaultValue: 'draft',
        db: { isNullable: true },
      })

      const column = columnOf(field, 'status')
      expect(column.type).toEqual({ pack: 'pg', type: 'text' })
      expect(column.nullable).toBe(true)
      expect(column.default).toEqual({ kind: 'literal', value: 'draft' })
    })

    it('should keep nullable from db.isNullable for a required string select with default', () => {
      const field = select({
        options: [{ label: 'Draft', value: 'draft' }],
        defaultValue: 'draft',
        validation: { isRequired: true },
        db: { isNullable: true },
      })

      expect(columnOf(field, 'status').nullable).toBe(true)
    })

    it('should declare a union TypeScript face from the options', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
      })

      expect(field.outputType).toBe("'draft' | 'published'")
      expect(field.inputType).toBe("'draft' | 'published'")
    })

    it('should declare the same union when required — nullability lives on the column', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        validation: { isRequired: true },
      })

      expect(field.outputType).toBe("'draft' | 'published'")
      expect(columnOf(field, 'status').nullable).toBe(false)
    })
  })

  describe('enum type (db.type: enum)', () => {
    it('should throw for values that are not valid Prisma identifiers (hyphens)', () => {
      expect(() =>
        select({
          options: [{ label: 'In Progress', value: 'in-progress' }],
          db: { type: 'enum' },
        }),
      ).toThrow(/valid Prisma identifiers/)
    })

    it('should throw for values starting with a digit', () => {
      expect(() =>
        select({
          options: [{ label: 'First', value: '1st' }],
          db: { type: 'enum' },
        }),
      ).toThrow(/valid Prisma identifiers/)
    })

    it('should throw for values with spaces', () => {
      expect(() =>
        select({
          options: [{ label: 'In Progress', value: 'in progress' }],
          db: { type: 'enum' },
        }),
      ).toThrow(/valid Prisma identifiers/)
    })

    it('should accept values with underscores', () => {
      expect(() =>
        select({
          options: [
            { label: 'In Progress', value: 'in_progress' },
            { label: 'Done', value: 'done' },
          ],
          db: { type: 'enum' },
        }),
      ).not.toThrow()
    })

    it('should derive the enum name from listName + fieldName', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        db: { type: 'enum' },
      })

      const column = columnOf(field, 'status')
      expect(column.type).toEqual({ pack: 'pg', type: 'enum' })
      expect(column.enum?.name).toBe('PostStatus')
    })

    it('should capitalize fieldName when deriving the enum name', () => {
      const field = select({
        options: [
          { label: 'Article', value: 'article' },
          { label: 'Video', value: 'video' },
        ],
        db: { type: 'enum' },
      })

      expect(columnOf(field, 'contentType').enum?.name).toBe('PostContentType')
    })

    it('should carry the enum values on the column', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        db: { type: 'enum' },
      })

      expect(columnOf(field, 'status').enum?.values).toEqual(['draft', 'published'])
    })

    it('should be nullable for an optional enum field', () => {
      const field = select({
        options: [{ label: 'Draft', value: 'draft' }],
        db: { type: 'enum' },
      })

      expect(columnOf(field, 'status').nullable).toBe(true)
    })

    it('should not be nullable for a required enum field', () => {
      const field = select({
        options: [{ label: 'Draft', value: 'draft' }],
        db: { type: 'enum' },
        validation: { isRequired: true },
      })

      expect(columnOf(field, 'status').nullable).toBe(false)
    })

    it('should carry the default value as a literal for an enum field', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        db: { type: 'enum' },
        defaultValue: 'draft',
      })

      expect(columnOf(field, 'status').default).toEqual({ kind: 'literal', value: 'draft' })
    })

    it('should be non-nullable for an optional enum select with a default', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        db: { type: 'enum' },
        defaultValue: 'draft',
      })

      const column = columnOf(field, 'status')
      expect(column.default).toEqual({ kind: 'literal', value: 'draft' })
      expect(column.nullable).toBe(false)
    })

    it('should force nullable with db.isNullable even when a default is present (enum)', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        db: { type: 'enum', isNullable: true },
        defaultValue: 'draft',
      })

      const column = columnOf(field, 'status')
      expect(column.enum?.name).toBe('PostStatus')
      expect(column.nullable).toBe(true)
      expect(column.default).toEqual({ kind: 'literal', value: 'draft' })
    })

    it('should override the derived enum name with db.enumName', () => {
      const field = select({
        options: [
          { label: 'Open', value: 'open' },
          { label: 'Closed', value: 'closed' },
        ],
        db: { type: 'enum', enumName: 'AccountNoteStatusType' },
      })

      const column = columnOf(field, 'status', 'AccountNote')
      expect(column.enum).toEqual({
        name: 'AccountNoteStatusType',
        values: ['open', 'closed'],
      })
    })

    it('should ignore db.enumName for string (non-enum) selects', () => {
      const field = select({
        options: [{ label: 'Open', value: 'open' }],
        // enumName only applies to native-enum selects; string selects stay text
        db: { enumName: 'ShouldBeIgnored' },
      })

      const column = columnOf(field, 'status', 'AccountNote')
      expect(column.type).toEqual({ pack: 'pg', type: 'text' })
      expect(column.enum).toBeUndefined()
    })

    it('should carry the map for an enum field with a map option', () => {
      const field = select({
        options: [{ label: 'Draft', value: 'draft' }],
        db: { type: 'enum', map: 'post_status' },
      })

      expect(columnOf(field, 'status').map).toBe('post_status')
    })

    it('should declare the same union TypeScript face as a string select', () => {
      const enumField = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        db: { type: 'enum' },
      })

      const stringField = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
      })

      expect(enumField.outputType).toBe(stringField.outputType)
      expect(enumField.inputType).toBe(stringField.inputType)
    })
  })
})
