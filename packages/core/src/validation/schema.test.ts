import { describe, it, expect } from 'vitest'
import { generateZodSchema, validateWithZod } from './schema.js'
import type { FieldConfig } from '../config/types.js'
import { text, integer, select } from '../fields/index.js'

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
})
