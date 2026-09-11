import { describe, it, expect } from 'vitest'
import { applyClientValueTransforms } from '../../src/lib/clientValueTransforms.js'
import type { FieldConfig } from '@opensaas/stack-core'

function fields(map: Record<string, unknown>): Record<string, FieldConfig> {
  return map as Record<string, FieldConfig>
}

describe('applyClientValueTransforms', () => {
  it("applies a field's valueForClientSerialization", () => {
    const config = fields({
      secret: {
        type: 'password',
        ui: {
          valueForClientSerialization: ({ value }: { value: unknown }) => ({ isSet: !!value }),
        },
      },
      title: { type: 'text' },
    })

    expect(applyClientValueTransforms(config, { secret: 'hash', title: 'Post' })).toEqual({
      secret: { isSet: true },
      title: 'Post',
    })
  })

  // The list table serialises whole rows, so a field it never renders still
  // reaches the browser unless its transform runs here.
  it('redacts a field that is not among the displayed columns', () => {
    const config = fields({
      contentEmbedding: {
        type: 'embedding',
        ui: {
          listView: { defaultColumn: false },
          valueForClientSerialization: () => ({ isSet: true, vector: null }),
        },
      },
    })

    expect(
      applyClientValueTransforms(config, { contentEmbedding: { vector: [0.1, 0.2] } }),
    ).toEqual({ contentEmbedding: { isSet: true, vector: null } })
  })

  it('returns the record untouched when no field declares a transform', () => {
    const config = fields({ title: { type: 'text' } })
    const record = { title: 'Post' }

    expect(applyClientValueTransforms(config, record)).toBe(record)
  })

  it('does not mutate the record it is given', () => {
    const config = fields({
      title: { type: 'text', ui: { valueForClientSerialization: () => 'redacted' } },
    })
    const record = { title: 'Post' }

    expect(applyClientValueTransforms(config, record)).toEqual({ title: 'redacted' })
    expect(record).toEqual({ title: 'Post' })
  })

  it('ignores a non-function transform', () => {
    const config = fields({ title: { type: 'text', ui: { valueForClientSerialization: 'nope' } } })

    expect(applyClientValueTransforms(config, { title: 'Post' })).toEqual({ title: 'Post' })
  })
})
