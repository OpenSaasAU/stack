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

  // Regression: issue #597
  // A bare `z.unknown()` is treated as optional inside `z.object(...)`, so a
  // required-on-create json field used to pass when the key was omitted. The
  // create branch now refines the schema to reject undefined/absent keys while
  // still accepting any present non-null JSON value (object, array, primitive).
  // A present null is rejected by the issue #604 tightening below.
  describe('required json on create (issue #597)', () => {
    it('rejects an omitted required json field on create (key absent)', () => {
      const fields: Record<string, FieldConfig> = {
        meta: json({ validation: { isRequired: true } }),
        label: text(),
      }

      const result = validateWithZod({ label: 'x' }, fields, 'create')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors).toHaveProperty('meta')
        expect(result.errors.meta).toContain('is required')
      }
    })

    it('rejects an explicit undefined required json field on create', () => {
      const fields: Record<string, FieldConfig> = {
        meta: json({ validation: { isRequired: true } }),
      }

      const result = validateWithZod({ meta: undefined }, fields, 'create')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors).toHaveProperty('meta')
      }
    })

    it('accepts a present object value for a required json field on create', () => {
      const fields: Record<string, FieldConfig> = {
        meta: json({ validation: { isRequired: true } }),
      }

      const result = validateWithZod({ meta: { a: 1 } }, fields, 'create')
      expect(result.success).toBe(true)
    })

    it('accepts a present array value for a required json field on create', () => {
      const fields: Record<string, FieldConfig> = {
        meta: json({ validation: { isRequired: true } }),
      }

      const result = validateWithZod({ meta: [] }, fields, 'create')
      expect(result.success).toBe(true)
    })

    it('accepts a present primitive (0) value for a required json field on create', () => {
      const fields: Record<string, FieldConfig> = {
        meta: json({ validation: { isRequired: true } }),
      }

      const result = validateWithZod({ meta: 0 }, fields, 'create')
      expect(result.success).toBe(true)
    })

    it('allows an omitted non-required json field on create', () => {
      const fields: Record<string, FieldConfig> = {
        meta: json(),
        label: text(),
      }

      const result = validateWithZod({ label: 'x' }, fields, 'create')
      expect(result.success).toBe(true)
    })
  })

  // Regression: issue #604
  // A required json field means non-null. A present `null` must be rejected at
  // the validation layer (with a clear message) instead of surfacing later as a
  // DB NOT NULL violation. Omission on update must still pass (#570), and
  // omission on create must still be rejected (#597). Present non-null values
  // — including falsy 0/""/false — are accepted. The Prisma column stays NOT
  // NULL; only validation behaviour changes.
  describe('required json is non-null (issue #604)', () => {
    it('rejects a present null for a required json field on create', () => {
      const fields: Record<string, FieldConfig> = {
        meta: json({ validation: { isRequired: true } }),
      }

      const result = validateWithZod({ meta: null }, fields, 'create')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors).toHaveProperty('meta')
        expect(result.errors.meta).toContain('is required')
      }
    })

    it('rejects a present null for a required json field on update', () => {
      const fields: Record<string, FieldConfig> = {
        meta: json({ validation: { isRequired: true } }),
      }

      const result = validateWithZod({ meta: null }, fields, 'update')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors).toHaveProperty('meta')
        expect(result.errors.meta).toContain('is required')
      }
    })

    it('still allows an omitted required json field on update (preserves #570)', () => {
      const fields: Record<string, FieldConfig> = {
        meta: json({ validation: { isRequired: true } }),
        label: text(),
      }

      const result = validateWithZod({ label: 'x' }, fields, 'update')
      expect(result.success).toBe(true)
    })

    it('accepts a present object value for a required json field on update', () => {
      const fields: Record<string, FieldConfig> = {
        meta: json({ validation: { isRequired: true } }),
      }

      const result = validateWithZod({ meta: { a: 1 } }, fields, 'update')
      expect(result.success).toBe(true)
    })

    it('accepts a present falsy non-null value for a required json field on update', () => {
      const fields: Record<string, FieldConfig> = {
        meta: json({ validation: { isRequired: true } }),
      }

      expect(validateWithZod({ meta: 0 }, fields, 'update').success).toBe(true)
      expect(validateWithZod({ meta: '' }, fields, 'update').success).toBe(true)
      expect(validateWithZod({ meta: false }, fields, 'update').success).toBe(true)
    })

    it('accepts present falsy non-null values for a required json field on create', () => {
      const fields: Record<string, FieldConfig> = {
        meta: json({ validation: { isRequired: true } }),
      }

      expect(validateWithZod({ meta: 0 }, fields, 'create').success).toBe(true)
      expect(validateWithZod({ meta: '' }, fields, 'create').success).toBe(true)
      expect(validateWithZod({ meta: false }, fields, 'create').success).toBe(true)
    })

    it('accepts an omitted or present null value for a non-required json field', () => {
      const fields: Record<string, FieldConfig> = {
        meta: json(),
        label: text(),
      }

      expect(validateWithZod({ label: 'x' }, fields, 'create').success).toBe(true)
      expect(validateWithZod({ meta: null }, fields, 'create').success).toBe(true)
      expect(validateWithZod({ label: 'x' }, fields, 'update').success).toBe(true)
      expect(validateWithZod({ meta: null }, fields, 'update').success).toBe(true)
    })
  })
})
