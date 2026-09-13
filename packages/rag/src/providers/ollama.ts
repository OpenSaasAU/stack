import type { EmbeddingProvider } from './types.js'
import type { OllamaEmbeddingConfig } from '../config/types.js'

type OllamaEmbeddingResponse = {
  embedding: number[]
  model: string
  total_duration?: number
  load_duration?: number
  prompt_eval_count?: number
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly type = 'ollama'
  readonly model: string
  readonly dimensions: number

  private baseURL: string

  constructor(config: OllamaEmbeddingConfig) {
    this.baseURL = config.baseURL || 'http://localhost:11434'
    this.model = config.model || 'nomic-embed-text'

    if (!Number.isInteger(config.dimensions) || config.dimensions < 1) {
      throw new Error(
        `Ollama embedding provider (model "${this.model}") requires a positive integer ` +
          `"dimensions", got ${String(config.dimensions)}.`,
      )
    }
    this.dimensions = config.dimensions

    if (this.baseURL.endsWith('/')) {
      this.baseURL = this.baseURL.slice(0, -1)
    }
  }

  private async makeRequest<T>(endpoint: string, body: unknown): Promise<T> {
    const url = `${this.baseURL}${endpoint}`

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }

      return (await response.json()) as T
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`Failed to connect to Ollama at ${this.baseURL}. Ensure Ollama is running.`)
      }
      throw error
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Cannot generate embedding for empty text')
    }

    try {
      const response = await this.makeRequest<OllamaEmbeddingResponse>('/api/embeddings', {
        model: this.model,
        prompt: text,
      })

      // The declared `dimensions` is never reconciled against reality anywhere
      // else in the pipeline — it sizes the stored column and the zero-padding
      // below. Catching a mismatch here, against the first real vector the
      // model returns, fails at generation time with the actual width named;
      // left unchecked, the same mismatch instead surfaces at search time as
      // an opaque length comparison against a column that was already
      // written wrong (#1288). Checked inside this try so a malformed
      // response missing `embedding` entirely gets the same wrapped
      // diagnosis as every other failure here, rather than a raw TypeError.
      if (response.embedding.length !== this.dimensions) {
        throw new Error(
          `Ollama embedding provider (model "${this.model}") declared dimensions of ` +
            `${this.dimensions}, but the model returned a vector of length ` +
            `${response.embedding.length}. Set "dimensions" (or OLLAMA_EMBEDDING_DIMENSIONS) to ` +
            `${response.embedding.length}.`,
        )
      }

      return response.embedding
    } catch (error) {
      throw new Error(`Ollama embedding generation failed: ${(error as Error).message}`)
    }
  }

  /**
   * Ollama has no native batch embeddings endpoint, so this issues one
   * parallel request per text via `embed()`.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return []
    }

    const validTexts: string[] = []
    const validIndices: number[] = []

    texts.forEach((text, index) => {
      if (text && text.trim().length > 0) {
        validTexts.push(text)
        validIndices.push(index)
      }
    })

    if (validTexts.length === 0) {
      throw new Error('Cannot generate embeddings for all empty texts')
    }

    try {
      const embeddingPromises = validTexts.map((text) => this.embed(text))
      const embeddings = await Promise.all(embeddingPromises)

      const results: number[][] = new Array(texts.length)

      embeddings.forEach((embedding, i) => {
        const originalIndex = validIndices[i]
        results[originalIndex] = embedding
      })

      for (let i = 0; i < texts.length; i++) {
        if (!results[i]) {
          results[i] = new Array(this.dimensions).fill(0)
        }
      }

      return results
    } catch (error) {
      throw new Error(`Ollama batch embedding generation failed: ${(error as Error).message}`)
    }
  }
}

/**
 * @example
 * ```typescript
 * import { createOllamaProvider } from '@opensaas/stack-rag/providers'
 *
 * const provider = createOllamaProvider({
 *   type: 'ollama',
 *   baseURL: 'http://localhost:11434',
 *   model: 'nomic-embed-text',
 *   dimensions: 768
 * })
 *
 * const embedding = await provider.embed('Hello world')
 * ```
 */
export function createOllamaProvider(config: OllamaEmbeddingConfig): OllamaEmbeddingProvider {
  return new OllamaEmbeddingProvider(config)
}
