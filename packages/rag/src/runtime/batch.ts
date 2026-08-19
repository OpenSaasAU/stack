/**
 * Batch processing utilities with rate limiting and progress tracking
 */

import type { EmbeddingProvider } from '../providers/types.js'
import type { StoredEmbedding } from '../config/types.js'
import { generateEmbeddings } from './embeddings.js'

export interface BatchProcessOptions {
  provider: EmbeddingProvider

  texts: string[]

  batchSize?: number

  rateLimit?: number

  onProgress?: (progress: BatchProgress) => void

  /**
   * If omitted, a batch failure throws instead of being reported here.
   */
  onError?: (error: BatchError) => void

  maxRetries?: number

  /**
   * Delay before the first retry; each subsequent retry doubles it (exponential backoff).
   */
  retryDelay?: number

  includeSourceHash?: boolean
}

export interface BatchProgress {
  processed: number

  total: number

  failed: number

  percentage: number

  currentBatch: number

  totalBatches: number
}

export interface BatchError {
  batchNumber: number

  items: string[]

  error: Error

  retries: number
}

export interface BatchProcessResult {
  embeddings: StoredEmbedding[]

  failed: Array<{ text: string; error: Error }>

  stats: {
    total: number
    successful: number
    failed: number
    duration: number
  }
}

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

  const delayBetweenBatches = calculateBatchDelay(rateLimit)

  for (let i = 0; i < texts.length; i += batchSize) {
    const batchNumber = Math.floor(i / batchSize) + 1
    const batch = texts.slice(i, i + batchSize)

    try {
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
        throw error
      }

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

export class RateLimiter {
  private queue: Array<() => void> = []
  private requestTimestamps: number[] = []
  private readonly requestsPerMinute: number

  constructor(requestsPerMinute: number) {
    this.requestsPerMinute = requestsPerMinute
  }

  async waitForSlot(): Promise<void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        const now = Date.now()
        const oneMinuteAgo = now - 60_000

        this.requestTimestamps = this.requestTimestamps.filter((t) => t > oneMinuteAgo)

        if (this.requestTimestamps.length < this.requestsPerMinute) {
          this.requestTimestamps.push(now)
          resolve()
          return
        }

        const oldestTimestamp = this.requestTimestamps[0]
        const waitTime = oldestTimestamp + 60_000 - now

        setTimeout(tryAcquire, Math.max(waitTime, 100))
      }

      tryAcquire()
    })
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.waitForSlot()
    return fn()
  }
}

function calculateBatchDelay(requestsPerMinute: number): number {
  // Each batch counts as one request
  const requestsPerSecond = requestsPerMinute / 60
  const delayPerRequest = 1000 / requestsPerSecond

  return Math.ceil(delayPerRequest)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

      if (attempt === maxRetries) {
        break
      }

      const delay = initialDelay * Math.pow(2, attempt)
      await sleep(delay)
    }
  }

  throw lastError
}

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

  async add(item: T): Promise<R> {
    return new Promise((resolve, reject) => {
      this.queue.push({ item, resolve, reject })
      this.processNext()
    })
  }

  async addBatch(items: T[]): Promise<R[]> {
    return Promise.all(items.map((item) => this.add(item)))
  }

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

  get size(): number {
    return this.queue.length
  }

  get activeCount(): number {
    return this.processing
  }
}
