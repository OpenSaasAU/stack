import { describe, it, expect } from 'vitest'
import { generateZodSchema, validateWithZod } from './schema.js'
import type { FieldConfig } from '../config/types.js'
import { text, integer, select, calendarDay, json, password } from '../fields/index.js'

describe('Zod Schema Generation', () => {
  describe('generateZodSchema', () => {
    it('should generate schema for text field with required validation', () => {
      const fields: Record<string, FieldConfig> = {
        name: text({ validation: { isRequired: true } }),
      }

      const schema = generateZodSchema(fields, 'create')
      expect(schema).toBeDefined()
    })

    it('should generate schema for text field with length validation', () => {
      const fields: Record<string, FieldConfig> = {
        title: text({
          validation: { isRequired: true, length: { min: 3, max: 100 } },
        }),
      }

      const schema = generateZodSchema(fields, 'create')
      expect(schema).toBeDefined()
    })

    it('should generate schema for integer field with min/max validation', () => {
      const fields: Record<string, FieldConfig> = {
        age: integer({ validation: { isRequired: true, min: 0, max: 120 } }),
      }

      const schema = generateZodSchema(fields, 'create')
      expect(schema).toBeDefined()
    })

    it('should generate schema for select field', () => {
      const fields: Record<string, FieldConfig> = {
        status: select({
          options: [
            { label: 'Active', value: 'active' },
            { label: 'Inactive', value: 'inactive' },
          ],
          validation: { isRequired: true },
        }),
      }

      const schema = generateZodSchema(fields, 'create')
      expect(schema).toBeDefined()
    })

    it('should generate schema for enum select field', () => {
      const fields: Record<string, FieldConfig> = {
        status: select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
          db: { type: 'enum' },
          validation: { isRequired: true },
        }),
      }

      const schema = generateZodSchema(fields, 'create')
      expect(schema).toBeDefined()
    })

    it('should make fields optional in update mode', () => {
      const fields: Record<string, FieldConfig> = {
        name: text({ validation: { isRequired: true } }),
      }

      const schema = generateZodSchema(fields, 'update')
      expect(schema).toBeDefined()
    })
  })

  describe('validateWithZod', () => {
    it('should pass validation for valid text field', () => {
      const fields: Record<string, FieldConfig> = {
        name: text({ validation: { isRequired: true } }),
      }

      const result = validateWithZod({ name: 'John Doe' }, fields, 'create')
      expect(result.success).toBe(true)
    })

    it('should fail validation for missing required field', () => {
      const fields: Record<string, FieldConfig> = {
        name: text({ validation: { isRequired: true } }),
      }

      const result = validateWithZod({}, fields, 'create')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors).toHaveProperty('name')
      }
    })

    it('should fail validation for text too short', () => {
      const fields: Record<string, FieldConfig> = {
        title: text({
          validation: { isRequired: true, length: { min: 5 } },
        }),
      }

      const result = validateWithZod({ title: 'Hi' }, fields, 'create')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.title).toContain('at least 5 characters')
      }
    })

    it('should fail validation for text too long', () => {
      const fields: Record<string, FieldConfig> = {
        title: text({ validation: { length: { max: 10 } } }),
      }

      const result = validateWithZod({ title: 'This is a very long title' }, fields, 'create')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.title).toContain('at most 10 characters')
      }
    })

    it('should fail validation for integer below min', () => {
      const fields: Record<string, FieldConfig> = {
        age: integer({ validation: { min: 18 } }),
      }

      const result = validateWithZod({ age: 15 }, fields, 'create')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.age).toContain('at least 18')
      }
    })

    it('should fail validation for integer above max', () => {
      const fields: Record<string, FieldConfig> = {
        age: integer({ validation: { max: 120 } }),
      }

      const result = validateWithZod({ age: 150 }, fields, 'create')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.age).toContain('at most 120')
      }
    })

    it('should fail validation for invalid select value', () => {
      const fields: Record<string, FieldConfig> = {
        status: select({
          options: [
            { label: 'Active', value: 'active' },
            { label: 'Inactive', value: 'inactive' },
          ],
          validation: { isRequired: true },
        }),
      }

      const result = validateWithZod({ status: 'invalid' }, fields, 'create')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.status).toBeDefined()
      }
    })

    it('should pass validation for valid enum select value', () => {
      const fields: Record<string, FieldConfig> = {
        status: select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
          db: { type: 'enum' },
          validation: { isRequired: true },
        }),
      }

      const result = validateWithZod({ status: 'draft' }, fields, 'create')
      expect(result.success).toBe(true)
    })

    it('should fail validation for invalid enum select value', () => {
      const fields: Record<string, FieldConfig> = {
        status: select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
          db: { type: 'enum' },
          validation: { isRequired: true },
        }),
      }

      const result = validateWithZod({ status: 'archived' }, fields, 'create')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.status).toBeDefined()
      }
    })

    it('should skip system fields in validation', () => {
      const fields: Record<string, FieldConfig> = {
        id: text(),
        name: text({ validation: { isRequired: true } }),
      }

      const result = validateWithZod({ name: 'John' }, fields, 'create')
      expect(result.success).toBe(true)
    })

    it('should allow required fields to be missing in update mode', () => {
      const fields: Record<string, FieldConfig> = {
        name: text({ validation: { isRequired: true } }),
      }

      const result = validateWithZod({}, fields, 'update')
      expect(result.success).toBe(true)
    })
  })

  // Regression: issue #570
  // Under zod 4.4, `z.union([schema, z.undefined()])` rejects a MISSING key,
  // so partial updates that omit a required-on-create field used to throw a
  // ValidationError before the DB write. Update-shapes must use key-optionality
  // (`.optional()`) so validation only checks the keys actually present.
  describe('omitted required field on update (issue #570)', () => {
    it('passes when a required text field is omitted while another field is present', () => {
      const fields: Record<string, FieldConfig> = {
        name: text({ validation: { isRequired: true } }),
        bio: text(),
      }

      const result = validateWithZod({ bio: 'hello' }, fields, 'update')
      expect(result.success).toBe(true)
    })

    it('still enforces present-value rules for a required text field on update', () => {
      const fields: Record<string, FieldConfig> = {
        name: text({ validation: { isRequired: true } }),
      }

      // Empty string must still be rejected when the key IS present
      const result = validateWithZod({ name: '' }, fields, 'update')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors).toHaveProperty('name')
      }
    })

    it('still enforces length rules for a required text field present on update', () => {
      const fields: Record<string, FieldConfig> = {
        title: text({ validation: { isRequired: true, length: { min: 5 } } }),
      }

      const result = validateWithZod({ title: 'Hi' }, fields, 'update')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.title).toContain('at least 5 characters')
      }
    })

    it('keeps required text fields required on create', () => {
      const fields: Record<string, FieldConfig> = {
        name: text({ validation: { isRequired: true } }),
      }

      const result = validateWithZod({}, fields, 'create')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors).toHaveProperty('name')
      }
    })

    it('allows an omitted required calendarDay field on update', () => {
      const fields: Record<string, FieldConfig> = {
        startsOn: calendarDay({ validation: { isRequired: true } }),
        label: text(),
      }

      const result = validateWithZod({ label: 'x' }, fields, 'update')
      expect(result.success).toBe(true)
    })

    it('still rejects an invalid calendarDay value when present on update', () => {
      const fields: Record<string, FieldConfig> = {
        startsOn: calendarDay({ validation: { isRequired: true } }),
      }

      const result = validateWithZod({ startsOn: 'not-a-date' }, fields, 'update')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors).toHaveProperty('startsOn')
      }
    })

    it('allows an omitted required json field on update', () => {
      const fields: Record<string, FieldConfig> = {
        meta: json({ validation: { isRequired: true } }),
        label: text(),
      }

      const result = validateWithZod({ label: 'x' }, fields, 'update')
      expect(result.success).toBe(true)
    })

    it('allows an omitted required password field on update', () => {
      const fields: Record<string, FieldConfig> = {
        secret: password({ validation: { isRequired: true } }),
        label: text(),
      }

      const result = validateWithZod({ label: 'x' }, fields, 'update')
      expect(result.success).toBe(true)
    })

    it('still rejects an empty required password value when present on update', () => {
      const fields: Record<string, FieldConfig> = {
        secret: password({ validation: { isRequired: true } }),
      }

      const result = validateWithZod({ secret: '' }, fields, 'update')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors).toHaveProperty('secret')
      }
    })
  })
})
