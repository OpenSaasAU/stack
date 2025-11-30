import type { EmbeddingProvider } from './types.js'
import type { OllamaEmbeddingConfig } from '../config/types.js'

/**
 * Ollama API response types
 */
type OllamaEmbeddingResponse = {
  embedding: number[]
  model: string
  total_duration?: number
  load_duration?: number
  prompt_eval_count?: number
}

/**
 * Ollama embedding provider
 * Uses local Ollama instance for embedding generation
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly type = 'ollama'
  readonly model: string
  dimensions: number = 0 // Will be determined from first embedding

  private baseURL: string
  private dimensionsInitialized = false

  constructor(config: OllamaEmbeddingConfig) {
    this.baseURL = config.baseURL || 'http://localhost:11434'
    this.model = config.model || 'nomic-embed-text'

    // Remove trailing slash from baseURL
    if (this.baseURL.endsWith('/')) {
      this.baseURL = this.baseURL.slice(0, -1)
    }
  }

  /**
   * Initialize dimensions by generating a test embedding
   */
  private async initializeDimensions(): Promise<void> {
    if (this.dimensionsInitialized) {
      return
    }

    try {
      const testEmbedding = await this.embed('test')
      this.dimensions = testEmbedding.length
      this.dimensionsInitialized = true
    } catch (error) {
      throw new Error(
        `Failed to initialize Ollama provider (ensure Ollama is running and model '${this.model}' is available): ${(error as Error).message}`,
      )
    }
  }

  /**
   * Make HTTP request to Ollama API
   */
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

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Cannot generate embedding for empty text')
    }

    try {
      const response = await this.makeRequest<OllamaEmbeddingResponse>('/api/embeddings', {
        model: this.model,
        prompt: text,
      })

      // Initialize dimensions if not yet done
      if (!this.dimensionsInitialized) {
        this.dimensions = response.embedding.length
        this.dimensionsInitialized = true
      }

      return response.embedding
    } catch (error) {
      throw new Error(`Ollama embedding generation failed: ${(error as Error).message}`)
    }
  }

  /**
   * Generate embeddings for multiple texts in a batch
   * Note: Ollama doesn't have native batch API, so we make parallel requests
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return []
    }

    // Filter out empty texts and keep track of indices
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

    // Ensure dimensions are initialized (only after validating we have valid texts)
    if (!this.dimensionsInitialized) {
      await this.initializeDimensions()
    }

    try {
      // Make parallel requests (Ollama doesn't have batch API)
      const embeddingPromises = validTexts.map((text) => this.embed(text))
      const embeddings = await Promise.all(embeddingPromises)

      // Create result array with correct size
      const results: number[][] = new Array(texts.length)

      // Fill in embeddings for valid texts
      embeddings.forEach((embedding, i) => {
        const originalIndex = validIndices[i]
        results[originalIndex] = embedding
      })

      // Fill in empty arrays for invalid texts
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
 * Create an Ollama embedding provider instance
 *
 * @example
 * ```typescript
 * import { createOllamaProvider } from '@opensaas/stack-rag/providers'
 *
 * const provider = createOllamaProvider({
 *   type: 'ollama',
 *   baseURL: 'http://localhost:11434',
 *   model: 'nomic-embed-text'
 * })
 *
 * const embedding = await provider.embed('Hello world')
 * ```
 */
export function createOllamaProvider(config: OllamaEmbeddingConfig): OllamaEmbeddingProvider {
  return new OllamaEmbeddingProvider(config)
}
