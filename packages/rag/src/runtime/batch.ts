/**
 * Batch processing utilities with rate limiting and progress tracking
 */

import type { EmbeddingProvider } from '../providers/types.js'
import type { StoredEmbedding } from '../config/types.js'
import { generateEmbeddings } from './embeddings.js'

export interface BatchProcessOptions {
  /**
   * Embedding provider to use
   */
  provider: EmbeddingProvider

  /**
   * Array of texts to process
   */
  texts: string[]

  /**
   * Batch size for processing
   * @default 10
   */
  batchSize?: number

  /**
   * Rate limit in requests per minute
   * @default 100
   */
  rateLimit?: number

  /**
   * Progress callback called after each batch
   */
  onProgress?: (progress: BatchProgress) => void

  /**
   * Error callback called when a batch fails
   * If not provided, errors will be thrown
   */
  onError?: (error: BatchError) => void

  /**
   * Number of retries for failed batches
   * @default 3
   */
  maxRetries?: number

  /**
   * Initial retry delay in milliseconds
   * @default 1000
   */
  retryDelay?: number

  /**
   * Whether to include source hash in metadata
   * @default true
   */
  includeSourceHash?: boolean
}

export interface BatchProgress {
  /**
   * Number of items processed so far
   */
  processed: number

  /**
   * Total number of items to process
   */
  total: number

  /**
   * Number of items that failed
   */
  failed: number

  /**
   * Percentage completed (0-100)
   */
  percentage: number

  /**
   * Current batch number (1-indexed)
   */
  currentBatch: number

  /**
   * Total number of batches
   */
  totalBatches: number
}

export interface BatchError {
  /**
   * Batch number that failed
   */
  batchNumber: number

  /**
   * Items in the failed batch
   */
  items: string[]

  /**
   * Error that occurred
   */
  error: Error

  /**
   * Number of retry attempts made
   */
  retries: number
}

export interface BatchProcessResult {
  /**
   * Successfully generated embeddings
   */
  embeddings: StoredEmbedding[]

  /**
   * Texts that failed to process
   */
  failed: Array<{ text: string; error: Error }>

  /**
   * Total processing statistics
   */
  stats: {
    total: number
    successful: number
    failed: number
    duration: number
  }
}

/**
 * Process embeddings in batches with rate limiting and retry logic
 *
 * @example
 * ```typescript
 * const result = await batchProcess({
 *   provider: createEmbeddingProvider({ type: 'openai', apiKey: '...' }),
 *   texts: largeTextArray,
 *   batchSize: 10,
 *   rateLimit: 60, // 60 requests per minute
 *   onProgress: (progress) => {
 *     console.log(`Progress: ${progress.percentage}%`)
 *   },
 * })
 *
 * console.log(`Successfully processed: ${result.stats.successful}`)
 * console.log(`Failed: ${result.stats.failed}`)
 * ```
 */
export async function batchProcess(options: BatchProcessOptions): Promise<BatchProcessResult> {
  const {
    provider,
    texts,
    batchSize = 10,
    rateLimit = 100,
    onProgress,
    onError,
    maxRetries = 3,
    retryDelay = 1000,
    includeSourceHash = true,
  } = options

  const startTime = Date.now()
  const totalBatches = Math.ceil(texts.length / batchSize)
  const embeddings: StoredEmbedding[] = []
  const failed: Array<{ text: string; error: Error }> = []

  // Calculate delay between batches to respect rate limit
  const delayBetweenBatches = calculateBatchDelay(rateLimit)

  for (let i = 0; i < texts.length; i += batchSize) {
    const batchNumber = Math.floor(i / batchSize) + 1
    const batch = texts.slice(i, i + batchSize)

    try {
      // Process batch with retry logic
      const batchEmbeddings = await retryWithBackoff(
        async () =>
          generateEmbeddings({
            provider,
            texts: batch,
            includeSourceHash,
            batchSize: batch.length,
          }),
        maxRetries,
        retryDelay,
      )

      embeddings.push(...batchEmbeddings)

      // Report progress
      if (onProgress) {
        const processed = Math.min(i + batchSize, texts.length)
        onProgress({
          processed,
          total: texts.length,
          failed: failed.length,
          percentage: Math.round((processed / texts.length) * 100),
          currentBatch: batchNumber,
          totalBatches,
        })
      }

      // Rate limiting: wait before next batch (except for last batch)
      if (batchNumber < totalBatches && delayBetweenBatches > 0) {
        await sleep(delayBetweenBatches)
      }
    } catch (error) {
      const batchError: BatchError = {
        batchNumber,
        items: batch,
        error: error instanceof Error ? error : new Error(String(error)),
        retries: maxRetries,
      }

      if (onError) {
        onError(batchError)
      } else {
        // If no error handler, throw the error
        throw error
      }

      // Add all items in batch to failed list
      for (const text of batch) {
        failed.push({
          text,
          error: batchError.error,
        })
      }
    }
  }

  const duration = Date.now() - startTime

  return {
    embeddings,
    failed,
    stats: {
      total: texts.length,
      successful: embeddings.length,
      failed: failed.length,
      duration,
    },
  }
}

/**
 * Rate limiter for controlling API request rate
 */
export class RateLimiter {
  private queue: Array<() => void> = []
  private requestTimestamps: number[] = []
  private readonly requestsPerMinute: number

  constructor(requestsPerMinute: number) {
    this.requestsPerMinute = requestsPerMinute
  }

  /**
   * Wait until rate limit allows next request
   */
  async waitForSlot(): Promise<void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        const now = Date.now()
        const oneMinuteAgo = now - 60_000

        // Remove timestamps older than 1 minute
        this.requestTimestamps = this.requestTimestamps.filter((t) => t > oneMinuteAgo)

        // Check if we can make a request
        if (this.requestTimestamps.length < this.requestsPerMinute) {
          this.requestTimestamps.push(now)
          resolve()
          return
        }

        // Calculate wait time until oldest request expires
        const oldestTimestamp = this.requestTimestamps[0]
        const waitTime = oldestTimestamp + 60_000 - now

        // Try again after wait time
        setTimeout(tryAcquire, Math.max(waitTime, 100))
      }

      tryAcquire()
    })
  }

  /**
   * Execute a function with rate limiting
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.waitForSlot()
    return fn()
  }
}

/**
 * Calculate delay between batches to respect rate limit
 */
function calculateBatchDelay(requestsPerMinute: number): number {
  // Each batch counts as one request
  const requestsPerSecond = requestsPerMinute / 60
  const delayPerRequest = 1000 / requestsPerSecond

  // Return delay in milliseconds
  return Math.ceil(delayPerRequest)
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retry a function with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  initialDelay: number,
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break
      }

      // Exponential backoff: delay * 2^attempt
      const delay = initialDelay * Math.pow(2, attempt)
      await sleep(delay)
    }
  }

  throw lastError
}

/**
 * Queue for processing items with concurrency control
 */
export class ProcessingQueue<T, R> {
  private queue: Array<{ item: T; resolve: (value: R) => void; reject: (error: Error) => void }> =
    []
  private processing = 0
  private readonly concurrency: number
  private readonly processor: (item: T) => Promise<R>

  constructor(processor: (item: T) => Promise<R>, concurrency: number = 1) {
    this.processor = processor
    this.concurrency = concurrency
  }

  /**
   * Add an item to the queue
   */
  async add(item: T): Promise<R> {
    return new Promise((resolve, reject) => {
      this.queue.push({ item, resolve, reject })
      this.processNext()
    })
  }

  /**
   * Add multiple items to the queue
   */
  async addBatch(items: T[]): Promise<R[]> {
    return Promise.all(items.map((item) => this.add(item)))
  }

  /**
   * Process next item in queue
   */
  private async processNext(): Promise<void> {
    if (this.processing >= this.concurrency || this.queue.length === 0) {
      return
    }

    this.processing++
    const next = this.queue.shift()

    if (next) {
      try {
        const result = await this.processor(next.item)
        next.resolve(result)
      } catch (error) {
        next.reject(error instanceof Error ? error : new Error(String(error)))
      } finally {
        this.processing--
        this.processNext()
      }
    }
  }

  /**
   * Get current queue size
   */
  get size(): number {
    return this.queue.length
  }

  /**
   * Get number of items currently being processed
   */
  get activeCount(): number {
    return this.processing
  }
}
