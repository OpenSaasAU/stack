import type { EmbeddingProvider } from './types.js'
import type { OpenAIEmbeddingConfig, OpenAIEmbeddingModel } from '../config/types.js'

const MODEL_DIMENSIONS: Record<OpenAIEmbeddingModel, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
}

// `openai` is an optional peer dependency (see package.json) — a static import
// would break apps that don't install it.
async function getOpenAI() {
  try {
    const module = await import('openai')
    return module.default
  } catch {
    throw new Error(
      'OpenAI package not found. Install it with: npm install openai\n' +
        'Make sure to run: pnpm install openai',
    )
  }
}

// Mirrors the shape of `openai`'s embeddings client so this file doesn't need to
// import types from the (optional) `openai` package.
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

/** Requires the `openai` package to be installed (optional peer dependency). */
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
      const client = await this.ensureClient()
      const response = await client.embeddings.create({
        model: this.model,
        input: validTexts,
        encoding_format: 'float',
      })

      const results: number[][] = new Array(texts.length)

      response.data.forEach((item: { embedding: number[] }, i: number) => {
        const originalIndex = validIndices[i]
        results[originalIndex] = item.embedding
      })

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
