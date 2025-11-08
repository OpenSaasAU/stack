import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  batchProcess,
  RateLimiter,
  ProcessingQueue,
  type BatchProgress,
  type BatchError,
} from './batch.js'
import type { EmbeddingProvider } from '../providers/types.js'

// Mock embedding provider
function createMockProvider(delayMs: number = 0): EmbeddingProvider {
  return {
    type: 'mock',
    model: 'mock-model',
    dimensions: 3,
    embed: vi.fn(async (text: string) => {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
      return [text.length / 10, text.length / 20, text.length / 30]
    }),
    embedBatch: vi.fn(async (texts: string[]) => {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
      return texts.map((text) => [text.length / 10, text.length / 20, text.length / 30])
    }),
  }
}

describe('batchProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should process all texts successfully', async () => {
    const provider = createMockProvider()
    const texts = ['Text 1', 'Text 2', 'Text 3']

    const result = await batchProcess({
      provider,
      texts,
      batchSize: 2,
    })

    expect(result.embeddings).toHaveLength(3)
    expect(result.failed).toHaveLength(0)
    expect(result.stats.successful).toBe(3)
    expect(result.stats.failed).toBe(0)
  })

  it('should respect batch size', async () => {
    const provider = createMockProvider()
    const texts = Array(10).fill('Test')

    await batchProcess({
      provider,
      texts,
      batchSize: 3,
    })

    // Should be called 4 times: 3 + 3 + 3 + 1
    expect(provider.embedBatch).toHaveBeenCalledTimes(4)
  })

  it('should report progress', async () => {
    const provider = createMockProvider()
    const texts = Array(10).fill('Test')
    const progressCalls: BatchProgress[] = []

    await batchProcess({
      provider,
      texts,
      batchSize: 3,
      onProgress: (progress) => {
        progressCalls.push(progress)
      },
    })

    expect(progressCalls.length).toBeGreaterThan(0)

    const lastProgress = progressCalls[progressCalls.length - 1]
    expect(lastProgress.processed).toBe(10)
    expect(lastProgress.total).toBe(10)
    expect(lastProgress.percentage).toBe(100)
  })

  it('should handle errors with error callback', async () => {
    const provider = createMockProvider()
    provider.embedBatch = vi.fn().mockRejectedValue(new Error('API Error'))

    const texts = ['Text 1', 'Text 2']
    const errors: BatchError[] = []

    const result = await batchProcess({
      provider,
      texts,
      batchSize: 1,
      maxRetries: 0,
      onError: (error) => {
        errors.push(error)
      },
    })

    expect(errors.length).toBeGreaterThan(0)
    expect(result.failed.length).toBe(2)
    expect(result.stats.failed).toBe(2)
  })

  it('should throw error without error callback', async () => {
    const provider = createMockProvider()
    provider.embedBatch = vi.fn().mockRejectedValue(new Error('API Error'))

    const texts = ['Text 1']

    await expect(
      batchProcess({
        provider,
        texts,
        batchSize: 1,
        maxRetries: 0,
      }),
    ).rejects.toThrow('API Error')
  })

  it('should retry failed batches', async () => {
    const provider = createMockProvider()
    let callCount = 0

    provider.embedBatch = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount < 3) {
        throw new Error('Temporary error')
      }
      return [[1, 2, 3]]
    })

    const result = await batchProcess({
      provider,
      texts: ['Test'],
      batchSize: 1,
      maxRetries: 3,
      retryDelay: 10,
    })

    expect(result.embeddings).toHaveLength(1)
    expect(provider.embedBatch).toHaveBeenCalledTimes(3) // Initial + 2 retries
  })

  it('should track duration', async () => {
    const provider = createMockProvider(10) // 10ms delay
    const texts = ['Text 1', 'Text 2']

    const result = await batchProcess({
      provider,
      texts,
      batchSize: 1,
      rateLimit: 1000, // High rate limit to minimize delay
    })

    expect(result.stats.duration).toBeGreaterThan(0)
  })

  it('should include source hash in embeddings', async () => {
    const provider = createMockProvider()
    const texts = ['Text 1']

    const result = await batchProcess({
      provider,
      texts,
      includeSourceHash: true,
    })

    expect(result.embeddings[0].metadata.sourceHash).toBeDefined()
  })
})

describe('RateLimiter', () => {
  it('should allow requests under rate limit', async () => {
    const limiter = new RateLimiter(100) // 100 requests per minute

    const start = Date.now()

    // Should process quickly since we're under limit
    await limiter.waitForSlot()
    await limiter.waitForSlot()
    await limiter.waitForSlot()

    const duration = Date.now() - start

    // Should be nearly instant
    expect(duration).toBeLessThan(100)
  })

  it('should throttle requests exceeding rate limit', { timeout: 70000 }, async () => {
    const limiter = new RateLimiter(2) // Only 2 requests per minute

    const results: number[] = []

    // Try to make 3 requests
    for (let i = 0; i < 3; i++) {
      await limiter.waitForSlot()
      results.push(Date.now())
    }

    // Third request should be delayed
    const delay1 = results[1] - results[0]
    const delay2 = results[2] - results[1]

    expect(delay1).toBeLessThan(1000) // First two are quick
    expect(delay2).toBeGreaterThan(100) // Third is delayed
  }) // 70 second timeout for rate limiting test

  it('should execute function with rate limiting', async () => {
    const limiter = new RateLimiter(100)

    const result = await limiter.execute(async () => {
      return 'success'
    })

    expect(result).toBe('success')
  })

  it('should handle errors in executed function', async () => {
    const limiter = new RateLimiter(100)

    await expect(
      limiter.execute(async () => {
        throw new Error('Test error')
      }),
    ).rejects.toThrow('Test error')
  })
})

describe('ProcessingQueue', () => {
  it('should process items sequentially with concurrency 1', async () => {
    const processed: number[] = []
    const queue = new ProcessingQueue(
      async (item: number) => {
        processed.push(item)
        await new Promise((resolve) => setTimeout(resolve, 10))
        return item * 2
      },
      1, // concurrency
    )

    const promises = [queue.add(1), queue.add(2), queue.add(3)]

    const results = await Promise.all(promises)

    expect(results).toEqual([2, 4, 6])
    expect(processed).toEqual([1, 2, 3])
  })

  it('should process items concurrently with concurrency > 1', async () => {
    const queue = new ProcessingQueue(
      async (item: number) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return item * 2
      },
      3, // concurrency
    )

    const start = Date.now()
    const results = await queue.addBatch([1, 2, 3, 4, 5])
    const duration = Date.now() - start

    expect(results).toEqual([2, 4, 6, 8, 10])

    // With concurrency 3, should be faster than sequential
    // 5 items with 10ms each sequentially = 50ms
    // With concurrency 3: ceil(5/3) * 10ms = 20ms
    expect(duration).toBeLessThan(50)
  })

  it('should track queue size', async () => {
    const queue = new ProcessingQueue(async (item: number) => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return item
    }, 1)

    // Add items quickly
    queue.add(1)
    queue.add(2)
    queue.add(3)

    // Queue should have items waiting
    expect(queue.size).toBeGreaterThan(0)
  })

  it('should track active count', async () => {
    const queue = new ProcessingQueue(async (item: number) => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return item
    }, 2)

    // Start processing
    const promise1 = queue.add(1)
    const promise2 = queue.add(2)
    const promise3 = queue.add(3)

    // Give time for processing to start
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Should have 2 active (concurrency limit)
    expect(queue.activeCount).toBeLessThanOrEqual(2)

    await Promise.all([promise1, promise2, promise3])
  })

  it('should handle errors in processor', async () => {
    const queue = new ProcessingQueue(async (item: number) => {
      if (item === 2) {
        throw new Error('Processing error')
      }
      return item * 2
    }, 1)

    const result1 = await queue.add(1)
    expect(result1).toBe(2)

    await expect(queue.add(2)).rejects.toThrow('Processing error')

    const result3 = await queue.add(3)
    expect(result3).toBe(6)
  })

  it('should process empty batch', async () => {
    const queue = new ProcessingQueue(async (item: number) => item * 2, 1)

    const results = await queue.addBatch([])

    expect(results).toEqual([])
  })
})
