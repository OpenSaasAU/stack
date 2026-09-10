import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { richText } from '../src/fields/richText.js'

/**
 * `getZodSchema` returns the schema for one key. Its behaviour inside
 * `z.object()` is the part that matters and the part that regressed: a schema
 * can reject `undefined` on its own yet still make its key required, or accept
 * it and still refuse an absent key. Only the enclosing object shows which.
 */
function asKey(schema: z.ZodType) {
  return z.object({ content: schema })
}

const DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

describe('richText() zod schema', () => {
  describe('required field', () => {
    const field = richText({ validation: { isRequired: true } })

    it('accepts a document on create', () => {
      const schema = asKey(field.getZodSchema('content', 'create'))
      expect(schema.safeParse({ content: DOC }).success).toBe(true)
    })

    it('rejects an absent key on create', () => {
      const schema = asKey(field.getZodSchema('content', 'create'))
      expect(schema.safeParse({}).success).toBe(false)
    })

    // The regression: `z.any()` inside `z.object()` rejects an absent key but
    // accepts a present `null` or explicit `undefined`, so a required field
    // could be created empty against a non-nullable column.
    it('rejects a present null on create', () => {
      const schema = asKey(field.getZodSchema('content', 'create'))
      expect(schema.safeParse({ content: null }).success).toBe(false)
    })

    it('rejects a present undefined on create', () => {
      const schema = asKey(field.getZodSchema('content', 'create'))
      expect(schema.safeParse({ content: undefined }).success).toBe(false)
    })

    // The regression: an update that never mentions the field — editing only
    // an article's title — was refused with "expected nonoptional, received
    // undefined", because `z.union([schema, z.undefined()])` is still a
    // required key inside `z.object()`.
    it('accepts an absent key on update', () => {
      const schema = asKey(field.getZodSchema('content', 'update'))
      expect(schema.safeParse({}).success).toBe(true)
    })

    it('still rejects a present null on update', () => {
      const schema = asKey(field.getZodSchema('content', 'update'))
      expect(schema.safeParse({ content: null }).success).toBe(false)
    })

    it('accepts a document on update', () => {
      const schema = asKey(field.getZodSchema('content', 'update'))
      expect(schema.safeParse({ content: DOC }).success).toBe(true)
    })
  })

  describe('optional field', () => {
    const field = richText()

    it('accepts an absent key on create', () => {
      const schema = asKey(field.getZodSchema('excerpt', 'create'))
      expect(schema.safeParse({}).success).toBe(true)
    })

    it('accepts null on create', () => {
      const schema = asKey(field.getZodSchema('excerpt', 'create'))
      expect(schema.safeParse({ content: null }).success).toBe(true)
    })

    it('accepts an absent key on update', () => {
      const schema = asKey(field.getZodSchema('excerpt', 'update'))
      expect(schema.safeParse({}).success).toBe(true)
    })
  })
})

describe('richText() contract field', () => {
  it('is a non-nullable jsonb column when required', () => {
    const descriptor = richText({ validation: { isRequired: true } }).getContractField('content')
    expect(descriptor.nullable).toBe(false)
  })

  it('is a nullable jsonb column by default', () => {
    const descriptor = richText().getContractField('excerpt')
    expect(descriptor.nullable).toBe(true)
  })

  it('reports the Tiptap document as its output type, nullable when optional', () => {
    expect(richText({ validation: { isRequired: true } }).outputType).not.toContain('| null')
    expect(richText().outputType).toContain('| null')
  })
})
