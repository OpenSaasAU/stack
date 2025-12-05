import { describe, it, expect } from 'vitest'
import { searchable } from './searchable.js'
import type { BaseFieldConfig } from '@opensaas/stack-core'
import type { SearchableOptions } from '../config/types.js'

// Mock text field for testing
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock function for testing
function mockTextField(): BaseFieldConfig<any> {
  return {
    type: 'text',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getZodSchema: () => null as any,
    getPrismaType: () => ({ type: 'String', modifiers: '' }),
    getTypeScriptType: () => ({ type: 'string', optional: false }),
  }
}

describe('searchable() field wrapper', () => {
  it('should preserve original field properties', () => {
    const field = mockTextField()
    const wrapped = searchable(field)

    expect(wrapped.type).toBe('text')
    expect(wrapped.getZodSchema).toBe(field.getZodSchema)
    expect(wrapped.getPrismaType).toBe(field.getPrismaType)
    expect(wrapped.getTypeScriptType).toBe(field.getTypeScriptType)
  })

  it('should attach _searchable metadata', () => {
    const field = mockTextField()
    const wrapped = searchable(field, { provider: 'openai' })

    expect(wrapped._searchable).toBeDefined()
    expect(wrapped._searchable.provider).toBe('openai')
  })

  it('should use default options when not provided', () => {
    const field = mockTextField()
    const wrapped = searchable(field)

    expect(wrapped._searchable).toBeDefined()
    expect(wrapped._searchable.embeddingFieldName).toBe('')
    expect(wrapped._searchable.provider).toBeUndefined()
    expect(wrapped._searchable.dimensions).toBeUndefined()
  })

  it('should accept all searchable options', () => {
    const field = mockTextField()
    const options: SearchableOptions = {
      provider: 'ollama',
      dimensions: 768,
      chunking: {
        strategy: 'sentence',
        maxTokens: 300,
        overlap: 25,
      },
      embeddingFieldName: 'customEmbedding',
    }

    const wrapped = searchable(field, options)

    expect(wrapped._searchable.provider).toBe('ollama')
    expect(wrapped._searchable.dimensions).toBe(768)
    expect(wrapped._searchable.chunking).toEqual({
      strategy: 'sentence',
      maxTokens: 300,
      overlap: 25,
    })
    expect(wrapped._searchable.embeddingFieldName).toBe('customEmbedding')
  })

  it('should preserve field with validation options', () => {
    const fieldWithValidation = {
      ...mockTextField(),
      validation: {
        isRequired: true,
        length: { min: 10, max: 1000 },
      },
    }

    const wrapped = searchable(fieldWithValidation, { provider: 'openai' })

    expect(wrapped.validation).toEqual({
      isRequired: true,
      length: { min: 10, max: 1000 },
    })
    expect(wrapped._searchable).toBeDefined()
  })

  it('should preserve field with hooks', () => {
    const resolveInputHook = () => {}
    const fieldWithHooks = {
      ...mockTextField(),
      hooks: {
        resolveInput: resolveInputHook,
      },
    }

    const wrapped = searchable(fieldWithHooks)

    expect(wrapped.hooks).toBeDefined()
    expect(wrapped.hooks?.resolveInput).toBe(resolveInputHook)
    expect(wrapped._searchable).toBeDefined()
  })

  it('should work with different field types', () => {
    const richTextField = {
      ...mockTextField(),
      type: 'richText' as const,
    }

    const wrapped = searchable(richTextField, { provider: 'openai' })

    expect(wrapped.type).toBe('richText')
    expect(wrapped._searchable).toBeDefined()
  })

  it('should handle empty embeddingFieldName option', () => {
    const field = mockTextField()
    const wrapped = searchable(field, { embeddingFieldName: '' })

    expect(wrapped._searchable.embeddingFieldName).toBe('')
  })

  it('should handle partial chunking config', () => {
    const field = mockTextField()
    const wrapped = searchable(field, {
      chunking: {
        strategy: 'recursive',
      },
    })

    expect(wrapped._searchable.chunking).toEqual({
      strategy: 'recursive',
    })
  })
})
