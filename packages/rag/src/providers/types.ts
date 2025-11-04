/**
 * Embedding provider interface
 * All embedding providers must implement this interface
 */
export interface EmbeddingProvider {
  /**
   * Provider type identifier
   */
  readonly type: string

  /**
   * Model name being used
   */
  readonly model: string

  /**
   * Number of dimensions in the embedding vector
   */
  readonly dimensions: number

  /**
   * Generate embedding for a single text
   *
   * @param text - The text to embed
   * @returns The embedding vector
   */
  embed(text: string): Promise<number[]>

  /**
   * Generate embeddings for multiple texts in a batch
   * More efficient than calling embed() multiple times
   *
   * @param texts - Array of texts to embed
   * @returns Array of embedding vectors in the same order as inputs
   */
  embedBatch(texts: string[]): Promise<number[][]>
}

/**
 * Result from embedding generation
 */
export type EmbeddingResult = {
  /**
   * The embedding vector
   */
  vector: number[]

  /**
   * Number of tokens in the input text
   */
  tokens?: number

  /**
   * Model used for generation
   */
  model: string
}

/**
 * Batch embedding result
 */
export type BatchEmbeddingResult = {
  /**
   * Array of embedding vectors
   */
  vectors: number[][]

  /**
   * Total tokens processed
   */
  totalTokens?: number

  /**
   * Model used for generation
   */
  model: string
}

/**
 * Options for embedding generation
 */
export type EmbedOptions = {
  /**
   * Maximum number of texts to embed in a single batch
   * @default 10
   */
  batchSize?: number

  /**
   * Rate limit in requests per minute
   * @default 100
   */
  rateLimit?: number

  /**
   * Whether to show progress for large batches
   * @default false
   */
  showProgress?: boolean
}
