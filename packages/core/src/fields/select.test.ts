import { describe, it, expect } from 'vitest'
import { select } from './index.js'

describe('select field builder', () => {
  describe('string type (default)', () => {
    it('should throw when no options are provided', () => {
      expect(() => select({ options: [] })).toThrow('Select field must have at least one option')
    })

    it('should return String prisma type for default select field', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
      })

      const result = field.getPrismaType!('status', 'sqlite', 'Post')
      expect(result.type).toBe('String')
      expect(result.enumValues).toBeUndefined()
    })

    it('should add ? modifier for optional string select', () => {
      const field = select({
        options: [{ label: 'Draft', value: 'draft' }],
      })

      const result = field.getPrismaType!('status', 'sqlite', 'Post')
      expect(result.modifiers).toBe('?')
    })

    it('should not add ? modifier for required string select', () => {
      const field = select({
        options: [{ label: 'Draft', value: 'draft' }],
        validation: { isRequired: true },
      })

      const result = field.getPrismaType!('status', 'sqlite', 'Post')
      expect(result.modifiers).toBeUndefined()
    })

    it('should generate quoted default value for string select', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        defaultValue: 'draft',
      })

      const result = field.getPrismaType!('status', 'sqlite', 'Post')
      expect(result.modifiers).toBe(' @default("draft")')
    })

    it('should emit NOT NULL (no ?) for optional string select with a default', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        defaultValue: 'draft',
      })

      const result = field.getPrismaType!('status', 'sqlite', 'Post')
      // Default behaviour: a present default makes the column NOT NULL
      expect(result.modifiers).toBe(' @default("draft")')
      expect(result.modifiers).not.toContain('?')
    })

    it('should force ? with db.isNullable even when a default is present (string)', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        defaultValue: 'draft',
        db: { isNullable: true },
      })

      const result = field.getPrismaType!('status', 'sqlite', 'Post')
      expect(result.type).toBe('String')
      expect(result.modifiers).toBe('? @default("draft")')
    })

    it('should keep ? from db.isNullable for a required string select with default', () => {
      const field = select({
        options: [{ label: 'Draft', value: 'draft' }],
        defaultValue: 'draft',
        validation: { isRequired: true },
        db: { isNullable: true },
      })

      const result = field.getPrismaType!('status', 'sqlite', 'Post')
      expect(result.modifiers).toBe('? @default("draft")')
    })

    it('should generate union TypeScript type from options', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
      })

      const result = field.getTypeScriptType!()
      expect(result.type).toBe("'draft' | 'published'")
      expect(result.optional).toBe(true)
    })

    it('should mark TypeScript type as non-optional when required', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        validation: { isRequired: true },
      })

      const result = field.getTypeScriptType!()
      expect(result.optional).toBe(false)
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

    it('should return derived enum name from listName + fieldName', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        db: { type: 'enum' },
      })

      const result = field.getPrismaType!('status', 'sqlite', 'Post')
      expect(result.type).toBe('PostStatus')
    })

    it('should capitalize fieldName when deriving enum name', () => {
      const field = select({
        options: [
          { label: 'Article', value: 'article' },
          { label: 'Video', value: 'video' },
        ],
        db: { type: 'enum' },
      })

      const result = field.getPrismaType!('contentType', 'sqlite', 'Post')
      expect(result.type).toBe('PostContentType')
    })

    it('should fall back to capitalized fieldName when listName is not provided', () => {
      const field = select({
        options: [{ label: 'Draft', value: 'draft' }],
        db: { type: 'enum' },
      })

      const result = field.getPrismaType!('status')
      expect(result.type).toBe('Status')
    })

    it('should return enumValues in getPrismaType result', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        db: { type: 'enum' },
      })

      const result = field.getPrismaType!('status', 'sqlite', 'Post')
      expect(result.enumValues).toEqual(['draft', 'published'])
    })

    it('should add ? modifier for optional enum field', () => {
      const field = select({
        options: [{ label: 'Draft', value: 'draft' }],
        db: { type: 'enum' },
      })

      const result = field.getPrismaType!('status', 'sqlite', 'Post')
      expect(result.modifiers).toBe('?')
    })

    it('should not add ? modifier for required enum field', () => {
      const field = select({
        options: [{ label: 'Draft', value: 'draft' }],
        db: { type: 'enum' },
        validation: { isRequired: true },
      })

      const result = field.getPrismaType!('status', 'sqlite', 'Post')
      expect(result.modifiers).toBeUndefined()
    })

    it('should generate unquoted default value for enum field', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        db: { type: 'enum' },
        defaultValue: 'draft',
      })

      const result = field.getPrismaType!('status', 'sqlite', 'Post')
      expect(result.modifiers).toBe(' @default(draft)')
      // Explicitly check there are no quotes
      expect(result.modifiers).not.toContain('"')
    })

    it('should emit NOT NULL (no ?) for optional enum select with a default', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        db: { type: 'enum' },
        defaultValue: 'draft',
      })

      const result = field.getPrismaType!('status', 'sqlite', 'Post')
      expect(result.modifiers).toBe(' @default(draft)')
      expect(result.modifiers).not.toContain('?')
    })

    it('should force ? with db.isNullable even when a default is present (enum)', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        db: { type: 'enum', isNullable: true },
        defaultValue: 'draft',
      })

      const result = field.getPrismaType!('status', 'sqlite', 'Post')
      expect(result.type).toBe('PostStatus')
      expect(result.modifiers).toBe('? @default(draft)')
    })

    it('should override the derived enum name with db.enumName', () => {
      const field = select({
        options: [
          { label: 'Open', value: 'open' },
          { label: 'Closed', value: 'closed' },
        ],
        db: { type: 'enum', enumName: 'AccountNoteStatusType' },
      })

      const result = field.getPrismaType!('status', 'sqlite', 'AccountNote')
      // result.type drives both the enum block name and the column reference
      expect(result.type).toBe('AccountNoteStatusType')
      expect(result.enumValues).toEqual(['open', 'closed'])
    })

    it('should ignore db.enumName for string (non-enum) selects', () => {
      const field = select({
        options: [{ label: 'Open', value: 'open' }],
        // enumName only applies to native-enum selects; string selects stay String
        db: { enumName: 'ShouldBeIgnored' },
      })

      const result = field.getPrismaType!('status', 'sqlite', 'AccountNote')
      expect(result.type).toBe('String')
      expect(result.enumValues).toBeUndefined()
    })

    it('should include @map modifier for enum field with map option', () => {
      const field = select({
        options: [{ label: 'Draft', value: 'draft' }],
        db: { type: 'enum', map: 'post_status' },
      })

      const result = field.getPrismaType!('status', 'sqlite', 'Post')
      expect(result.modifiers).toContain('@map("post_status")')
    })

    it('should generate same union TypeScript type as string select', () => {
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

      expect(enumField.getTypeScriptType!()).toEqual(stringField.getTypeScriptType!())
    })
  })
})
