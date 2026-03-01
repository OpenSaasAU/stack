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
