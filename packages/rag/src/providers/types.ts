export interface EmbeddingProvider {
  readonly type: string

  readonly model: string

  readonly dimensions: number

  embed(text: string): Promise<number[]>

  /**
   * More efficient than calling embed() multiple times.
   */
  embedBatch(texts: string[]): Promise<number[][]>
}

export type EmbeddingResult = {
  vector: number[]

  tokens?: number

  model: string
}

export type BatchEmbeddingResult = {
  vectors: number[][]

  totalTokens?: number

  model: string
}

export type EmbedOptions = {
  /**
   * Maximum number of texts to embed in a single batch.
   * @default 10
   */
  batchSize?: number

  /**
   * Rate limit in requests per minute.
   * @default 100
   */
  rateLimit?: number

  /**
   * Whether to show progress for large batches.
   * @default false
   */
  showProgress?: boolean
}
