import { describe, it, expect } from 'vitest'
import { redactEmbeddingForClient } from './embedding-display.js'
import { embedding } from './embedding.js'

const METADATA = {
  model: 'nomic-embed-text',
  provider: 'ollama',
  dimensions: 4,
  generatedAt: '2026-09-03T01:02:03.000Z',
  sourceHash: 'abc123',
}

const STORED = { vector: [0.1, 0.2, 0.3, 0.4], metadata: METADATA }

describe('redactEmbeddingForClient', () => {
  it('withholds the vector but keeps its length', () => {
    const result = redactEmbeddingForClient(STORED, { showVector: false, showMetadata: true })

    expect(result).toEqual({
      isSet: true,
      dimensions: 4,
      vector: null,
      metadata: METADATA,
    })
  })

  it('includes the vector when the field asks for it', () => {
    const result = redactEmbeddingForClient(STORED, { showVector: true, showMetadata: true })

    expect(result.vector).toEqual([0.1, 0.2, 0.3, 0.4])
  })

  it('withholds metadata the field does not display', () => {
    const result = redactEmbeddingForClient(STORED, { showVector: false, showMetadata: false })

    expect(result).toEqual({ isSet: true, dimensions: 4, vector: null, metadata: null })
  })

  it('reports an absent embedding', () => {
    for (const value of [null, undefined, {}, 'nonsense', 7]) {
      expect(redactEmbeddingForClient(value, { showVector: true, showMetadata: true })).toEqual({
        isSet: false,
        dimensions: null,
        vector: null,
        metadata: null,
      })
    }
  })

  it('keeps only the metadata entries the column actually holds', () => {
    const result = redactEmbeddingForClient(
      { vector: [1, 2], metadata: { provider: 'ollama', dimensions: 'four' } },
      { showVector: false, showMetadata: true },
    )

    expect(result.metadata).toEqual({ provider: 'ollama' })
  })

  it('treats a metadata blob with nothing recognisable as absent', () => {
    const result = redactEmbeddingForClient(
      { vector: [1, 2], metadata: { unrelated: true } },
      { showVector: false, showMetadata: true },
    )

    expect(result.metadata).toBeNull()
  })

  it('drops a vector holding anything but numbers', () => {
    const result = redactEmbeddingForClient(
      { vector: [1, 'two', 3], metadata: METADATA },
      { showVector: true, showMetadata: true },
    )

    expect(result).toMatchObject({ isSet: true, dimensions: 3, vector: null })
  })

  // A form re-serialising its own initial data hands back what it was given.
  it('is idempotent over its own output', () => {
    const once = redactEmbeddingForClient(STORED, { showVector: false, showMetadata: true })
    const twice = redactEmbeddingForClient(once, { showVector: false, showMetadata: true })

    expect(twice).toEqual(once)
  })

  it('cannot resurrect a vector an earlier pass dropped', () => {
    const redacted = redactEmbeddingForClient(STORED, { showVector: false, showMetadata: true })

    expect(
      redactEmbeddingForClient(redacted, { showVector: true, showMetadata: true }),
    ).toMatchObject({ isSet: true, dimensions: 4, vector: null })
  })
})

describe('embedding() client serialization', () => {
  it('does not serialize the vector by default', () => {
    const field = embedding({ dimensions: 4 })

    expect(field.ui?.valueForClientSerialization?.({ value: STORED })).toEqual({
      isSet: true,
      dimensions: 4,
      vector: null,
      metadata: METADATA,
    })
  })

  it('serializes the vector when ui.showVector is set', () => {
    const field = embedding({ dimensions: 4, ui: { showVector: true } })

    expect(field.ui?.valueForClientSerialization?.({ value: STORED })).toMatchObject({
      vector: [0.1, 0.2, 0.3, 0.4],
    })
  })

  it('does not serialize metadata when ui.showMetadata is off', () => {
    const field = embedding({ dimensions: 4, ui: { showMetadata: false } })

    expect(field.ui?.valueForClientSerialization?.({ value: STORED })).toMatchObject({
      metadata: null,
    })
  })

  // The admin UI's submit transform skips any value carrying `isSet`, which is
  // what stops a redacted embedding being sent back over the stored one.
  it('marks the serialized value so the item form does not resubmit it', () => {
    const field = embedding({ dimensions: 4 })
    const serialized = field.ui?.valueForClientSerialization?.({ value: STORED })

    expect(serialized).toHaveProperty('isSet')
  })

  it('keeps the vector out of the default list-table columns', () => {
    expect(embedding().ui?.listView?.defaultColumn).toBe(false)
  })

  it('lets a field opt back into the default columns', () => {
    const field = embedding({ ui: { listView: { defaultColumn: true } } })

    expect(field.ui?.listView?.defaultColumn).toBe(true)
  })

  it('carries allowManualWrites to the field component', () => {
    expect(embedding().ui?.allowManualWrites).toBe(false)
    expect(embedding({ allowManualWrites: true }).ui?.allowManualWrites).toBe(true)
  })
})
