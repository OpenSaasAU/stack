import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProviderFromEnv, getProviderConfigFromEnv } from './provider-helpers.js'

/**
 * `OllamaEmbeddingConfig.dimensions` is required, but these helpers build their
 * config as an object literal, and the provider union's third member is an open
 * `{ type: string }` catch-all — so an omission type-checked and reached the
 * provider as `undefined`. That broke the docs site's `EMBEDDING_PROVIDER=ollama`
 * search end to end and made `embedBatch`'s zero-vector padding one element long.
 */
describe('the Ollama provider these helpers build from the environment', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    delete process.env.OLLAMA_BASE_URL
    delete process.env.OLLAMA_EMBEDDING_DIMENSIONS
    process.env.EMBEDDING_PROVIDER = 'ollama'
  })

  afterEach(() => {
    process.env = { ...saved }
    vi.unstubAllGlobals()
  })

  it('carries nomic-embed-text’s 768 dimensions when the environment names none', () => {
    expect(createProviderFromEnv().dimensions).toBe(768)
    expect(getProviderConfigFromEnv()).toMatchObject({ type: 'ollama', dimensions: 768 })
  })

  it('takes the declared size for a model of another width', () => {
    process.env.OLLAMA_EMBEDDING_DIMENSIONS = '1024'

    expect(createProviderFromEnv().dimensions).toBe(1024)
    expect(getProviderConfigFromEnv()).toMatchObject({ dimensions: 1024 })
  })

  it('prefers an explicit override to the environment', () => {
    process.env.OLLAMA_EMBEDDING_DIMENSIONS = '1024'

    expect(createProviderFromEnv({ dimensions: 384 }).dimensions).toBe(384)
  })

  it('refuses a declared size that is not a positive integer', () => {
    process.env.OLLAMA_EMBEDDING_DIMENSIONS = 'lots'

    expect(() => createProviderFromEnv()).toThrow(
      'OLLAMA_EMBEDDING_DIMENSIONS is "lots", which is not a positive integer.',
    )
  })

  it('pads an empty input to a zero vector of the model’s width', async () => {
    // `embedBatch` pads only the empty entries of a batch that has at least one
    // real text, so one round trip has to answer. Ollama's /api/embeddings
    // shape: https://github.com/ollama/ollama/blob/main/docs/api.md
    const answer = new Array<number>(768).fill(0.5)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ embedding: answer, model: 'nomic' }))),
    )

    const provider = createProviderFromEnv()
    const [real, padded] = await provider.embedBatch(['hello', ''])

    expect(real).toEqual(answer)
    // Not `new Array(undefined)`, which is one element long.
    expect(padded).toHaveLength(768)
    expect(padded.every((value) => value === 0)).toBe(true)
  })
})
