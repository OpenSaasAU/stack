import type { EmbeddingProvider } from './types.js'
import type { OpenAIEmbeddingConfig, OpenAIEmbeddingModel } from '../config/types.js'

/**
 * Model dimensions mapping
 */
const MODEL_DIMENSIONS: Record<OpenAIEmbeddingModel, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
}

/**
 * Lazily load OpenAI to avoid requiring it at import time
 */
async function getOpenAI() {
  try {
    const module = await import('openai')
    return module.default
  } catch (error) {
    throw new Error(
      'OpenAI package not found. Install it with: npm install openai\n' +
        'Make sure to run: pnpm install openai',
    )
  }
}

/**
 * Type for OpenAI client (avoids direct dependency)
 */
type OpenAIClient = {
  embeddings: {
    create: (params: {
      model: string
      input: string | string[]
      encoding_format: string
    }) => Promise<{
      data: Array<{ embedding: number[] }>
    }>
  }
}

/**
 * OpenAI embedding provider
 * Requires the `openai` package to be installed
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly type = 'openai'
  readonly model: string
  readonly dimensions: number

  private client: OpenAIClient | null = null
  private config: OpenAIEmbeddingConfig
  private clientPromise: Promise<OpenAIClient> | null = null

  constructor(config: OpenAIEmbeddingConfig) {
    this.config = config
    this.model = config.model || 'text-embedding-3-small'
    this.dimensions = MODEL_DIMENSIONS[this.model as OpenAIEmbeddingModel] || 1536
  }

  private async ensureClient(): Promise<OpenAIClient> {
    if (this.client) return this.client
    if (this.clientPromise) return this.clientPromise

    this.clientPromise = this.initializeClient()
    this.client = await this.clientPromise
    return this.client
  }

  private async initializeClient(): Promise<OpenAIClient> {
    const OpenAI = await getOpenAI()

    return new OpenAI({
      apiKey: this.config.apiKey,
      organization: this.config.organization,
      baseURL: this.config.baseURL,
    }) as OpenAIClient
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Cannot generate embedding for empty text')
    }

    try {
      const client = await this.ensureClient()
      const response = await client.embeddings.create({
        model: this.model,
        input: text,
        encoding_format: 'float',
      })

      return response.data[0].embedding
    } catch (error) {
      throw new Error(`OpenAI embedding generation failed: ${(error as Error).message}`)
    }
  }

  /**
   * Generate embeddings for multiple texts in a batch
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

    try {
      // OpenAI supports batch embedding
      const client = await this.ensureClient()
      const response = await client.embeddings.create({
        model: this.model,
        input: validTexts,
        encoding_format: 'float',
      })

      // Create result array with correct size
      const results: number[][] = new Array(texts.length)

      // Fill in embeddings for valid texts
      response.data.forEach((item: { embedding: number[] }, i: number) => {
        const originalIndex = validIndices[i]
        results[originalIndex] = item.embedding
      })

      // Fill in empty arrays for invalid texts
      for (let i = 0; i < texts.length; i++) {
        if (!results[i]) {
          results[i] = new Array(this.dimensions).fill(0)
        }
      }

      return results
    } catch (error) {
      throw new Error(`OpenAI batch embedding generation failed: ${(error as Error).message}`)
    }
  }
}

/**
 * Create an OpenAI embedding provider instance
 *
 * @example
 * ```typescript
 * import { createOpenAIProvider } from '@opensaas/stack-rag/providers'
 *
 * const provider = createOpenAIProvider({
 *   type: 'openai',
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   model: 'text-embedding-3-small'
 * })
 *
 * const embedding = await provider.embed('Hello world')
 * ```
 */
export function createOpenAIProvider(config: OpenAIEmbeddingConfig): OpenAIEmbeddingProvider {
  return new OpenAIEmbeddingProvider(config)
}
