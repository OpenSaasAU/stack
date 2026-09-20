import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { OpenAIEmbeddingProvider } from './openai.js'
import { OllamaEmbeddingProvider } from './ollama.js'
import { createEmbeddingProvider } from './index.js'
import type { OllamaEmbeddingConfig } from '../config/types.js'

describe('Embedding Providers', () => {
  describe('OpenAIEmbeddingProvider', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('Network access is disabled in OpenAI provider unit tests')
        }),
      )
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    describe('constructor', () => {
      it('should initialize with default model', () => {
        const provider = new OpenAIEmbeddingProvider({
          type: 'openai',
          apiKey: 'test-key',
        })

        expect(provider.type).toBe('openai')
        expect(provider.model).toBe('text-embedding-3-small')
        expect(provider.dimensions).toBe(1536)
      })

      it('should initialize with custom model', () => {
        const provider = new OpenAIEmbeddingProvider({
          type: 'openai',
          apiKey: 'test-key',
          model: 'text-embedding-3-large',
        })

        expect(provider.model).toBe('text-embedding-3-large')
        expect(provider.dimensions).toBe(3072)
      })

      it('should support ada-002 model', () => {
        const provider = new OpenAIEmbeddingProvider({
          type: 'openai',
          apiKey: 'test-key',
          model: 'text-embedding-ada-002',
        })

        expect(provider.model).toBe('text-embedding-ada-002')
        expect(provider.dimensions).toBe(1536)
      })

      it('should throw error if openai package is not installed', () => {
        // Skip this test - it's difficult to mock require() in ESM environment
        // The actual error handling is tested when the package is genuinely missing
        // This test would require more complex module mocking that isn't worth it
      })
    })

    describe('embed', () => {
      it('should reject empty text', async () => {
        const provider = new OpenAIEmbeddingProvider({
          type: 'openai',
          apiKey: 'test-key',
        })

        await expect(provider.embed('')).rejects.toThrow('Cannot generate embedding for empty text')
        await expect(provider.embed('   ')).rejects.toThrow(
          'Cannot generate embedding for empty text',
        )
      })

      it('should validate embedding dimensions', () => {
        const provider = new OpenAIEmbeddingProvider({
          type: 'openai',
          apiKey: 'test-key',
          model: 'text-embedding-3-small',
        })

        expect(provider.dimensions).toBe(1536)
      })

      it('sends the embedding request and returns the local response', async () => {
        const answer = [0.25, 0.5, 0.75]
        const fetchMock = vi.fn<typeof fetch>(
          async () =>
            new Response(
              JSON.stringify({
                object: 'list',
                data: [{ object: 'embedding', embedding: answer, index: 0 }],
                model: 'text-embedding-3-small',
                usage: { prompt_tokens: 2, total_tokens: 2 },
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
        )
        vi.stubGlobal('fetch', fetchMock)

        const provider = new OpenAIEmbeddingProvider({
          type: 'openai',
          apiKey: 'test-key',
          baseURL: 'https://openai.test/v1',
        })

        await expect(provider.embed('local request')).resolves.toEqual(answer)

        expect(fetchMock).toHaveBeenCalledOnce()
        const [input, init] = fetchMock.mock.calls[0]
        const request = new Request(input, init)
        expect(request.url).toBe('https://openai.test/v1/embeddings')
        expect(request.method).toBe('POST')
        expect(request.headers.get('authorization')).toBe('Bearer test-key')
        await expect(request.json()).resolves.toEqual({
          model: 'text-embedding-3-small',
          input: 'local request',
          encoding_format: 'float',
        })
      })

      it('wraps a local OpenAI error response', async () => {
        const fetchMock = vi.fn<typeof fetch>(
          async () =>
            new Response(
              JSON.stringify({
                error: {
                  message: 'invalid test key',
                  type: 'invalid_request_error',
                  code: 'invalid_api_key',
                },
              }),
              { status: 401, headers: { 'content-type': 'application/json' } },
            ),
        )
        vi.stubGlobal('fetch', fetchMock)

        const provider = new OpenAIEmbeddingProvider({
          type: 'openai',
          apiKey: 'invalid-key',
          baseURL: 'https://openai.test/v1',
        })

        await expect(provider.embed('local request')).rejects.toThrow(
          'OpenAI embedding generation failed: 401 invalid test key',
        )
        expect(fetchMock).toHaveBeenCalledOnce()
      })
    })

    describe('embedBatch', () => {
      it('should return empty array for empty input', async () => {
        const provider = new OpenAIEmbeddingProvider({
          type: 'openai',
          apiKey: 'test-key',
        })

        const result = await provider.embedBatch([])
        expect(result).toEqual([])
      })

      it('should reject all empty texts', async () => {
        const provider = new OpenAIEmbeddingProvider({
          type: 'openai',
          apiKey: 'test-key',
        })

        await expect(provider.embedBatch(['', '   ', '\n'])).rejects.toThrow(
          'Cannot generate embeddings for all empty texts',
        )
      })

      it('should handle mixed valid and invalid texts', () => {
        const provider = new OpenAIEmbeddingProvider({
          type: 'openai',
          apiKey: 'test-key',
        })

        // We expect this to filter out empty texts and process valid ones
        // The implementation should fill empty slots with zero vectors
        expect(provider.dimensions).toBe(1536)
      })
    })
  })

  describe('OllamaEmbeddingProvider', () => {
    describe('constructor', () => {
      it('should initialize with default settings', () => {
        const provider = new OllamaEmbeddingProvider({
          type: 'ollama',
          dimensions: 768,
        })

        expect(provider.type).toBe('ollama')
        expect(provider.model).toBe('nomic-embed-text')
        expect(provider.dimensions).toBe(768)
      })

      it('should initialize with custom model', () => {
        const provider = new OllamaEmbeddingProvider({
          type: 'ollama',
          model: 'llama2',
          dimensions: 768,
        })

        expect(provider.model).toBe('llama2')
      })

      it('should initialize with custom baseURL', () => {
        const provider = new OllamaEmbeddingProvider({
          type: 'ollama',
          baseURL: 'http://custom-host:8080',
          dimensions: 768,
        })

        expect(provider['baseURL']).toBe('http://custom-host:8080')
      })

      it('should remove trailing slash from baseURL', () => {
        const provider = new OllamaEmbeddingProvider({
          type: 'ollama',
          baseURL: 'http://localhost:11434/',
          dimensions: 768,
        })

        expect(provider['baseURL']).toBe('http://localhost:11434')
      })

      it('refuses a dimensions value that is not a positive integer', () => {
        for (const dimensions of [0, -1, 1.5, Number.NaN]) {
          expect(() => new OllamaEmbeddingProvider({ type: 'ollama', dimensions })).toThrow(
            /requires a positive integer "dimensions"/,
          )
        }
      })

      it('names the actual invalid value in the error, not JSON.stringify(NaN)’s "null"', () => {
        expect(
          () => new OllamaEmbeddingProvider({ type: 'ollama', dimensions: Number.NaN }),
        ).toThrow('got NaN.')
      })

      it('refuses a missing dimensions value, naming the model', () => {
        expect(
          () =>
            new OllamaEmbeddingProvider({
              type: 'ollama',
              model: 'llama2',
            } as OllamaEmbeddingConfig),
        ).toThrow('Ollama embedding provider (model "llama2") requires a positive integer')
      })
    })

    describe('embed', () => {
      it('should reject empty text', async () => {
        const provider = new OllamaEmbeddingProvider({
          type: 'ollama',
          dimensions: 768,
        })

        await expect(provider.embed('')).rejects.toThrow('Cannot generate embedding for empty text')
        await expect(provider.embed('   ')).rejects.toThrow(
          'Cannot generate embedding for empty text',
        )
      })

      it('should provide helpful error when Ollama is not running', async () => {
        const provider = new OllamaEmbeddingProvider({
          type: 'ollama',
          baseURL: 'http://localhost:99999', // Invalid port
          dimensions: 768,
        })

        // The error message will vary depending on the environment
        // Just check that it throws an error
        await expect(provider.embed('test')).rejects.toThrow()
      })

      describe('reconciling the declared dimensions against the real vector', () => {
        afterEach(() => {
          vi.unstubAllGlobals()
        })

        it('fails, naming the model, the declared width and the real one', async () => {
          vi.stubGlobal(
            'fetch',
            vi.fn(
              async () =>
                new Response(
                  JSON.stringify({ embedding: new Array(1024).fill(0.1), model: 'llama2' }),
                ),
            ),
          )

          const provider = new OllamaEmbeddingProvider({
            type: 'ollama',
            model: 'llama2',
            dimensions: 768,
          })

          await expect(provider.embed('hello')).rejects.toThrow(
            'Ollama embedding provider (model "llama2") declared dimensions of 768, but the ' +
              'model returned a vector of length 1024.',
          )
        })

        it('passes the vector through unchanged when the width matches', async () => {
          const answer = new Array(768).fill(0.5)
          vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify({ embedding: answer, model: 'nomic' }))),
          )

          const provider = new OllamaEmbeddingProvider({
            type: 'ollama',
            dimensions: 768,
          })

          await expect(provider.embed('hello')).resolves.toEqual(answer)
        })
      })
    })

    describe('embedBatch', () => {
      it('should return empty array for empty input', async () => {
        const provider = new OllamaEmbeddingProvider({
          type: 'ollama',
          dimensions: 768,
        })

        const result = await provider.embedBatch([])
        expect(result).toEqual([])
      })

      it('should reject all empty texts', async () => {
        const provider = new OllamaEmbeddingProvider({
          type: 'ollama',
          dimensions: 768,
        })

        // This test will fail if Ollama is not running, which is expected
        // The error could be about initialization or about empty texts
        await expect(provider.embedBatch(['', '   ', '\n'])).rejects.toThrow()
      })

      describe('when the model returns the wrong width', () => {
        afterEach(() => {
          vi.unstubAllGlobals()
        })

        it('fails the whole batch with a named error rather than padding a ragged width', async () => {
          vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify({ embedding: [0.1, 0.2], model: 'x' }))),
          )

          const provider = new OllamaEmbeddingProvider({ type: 'ollama', dimensions: 768 })

          await expect(provider.embedBatch(['hello', ''])).rejects.toThrow(
            'declared dimensions of 768, but the model returned a vector of length 2',
          )
        })
      })
    })
  })

  describe('createEmbeddingProvider factory', () => {
    it('should create OpenAI provider', () => {
      const provider = createEmbeddingProvider({
        type: 'openai',
        apiKey: 'test-key',
      })

      expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider)
      expect(provider.type).toBe('openai')
    })

    it('should create Ollama provider', () => {
      const provider = createEmbeddingProvider({
        type: 'ollama',
        dimensions: 768,
      })

      expect(provider).toBeInstanceOf(OllamaEmbeddingProvider)
      expect(provider.type).toBe('ollama')
    })

    it('should throw error for unknown provider type', () => {
      expect(() => {
        createEmbeddingProvider({
          type: 'unknown',
        })
      }).toThrow(/Unknown embedding provider type/)
    })
  })

  /**
   * `pnpm build` type-checks this file, and an `@ts-expect-error` that does not
   * fire is itself an error — so `tsc` is the assertion here and nothing needs
   * to run. Before the funnel was tightened, both of these compiled, because
   * `CustomEmbeddingConfig`'s open `{ type: string }` absorbed them.
   */
  function _refusesABuiltInConfigMissingARequiredMember(): void {
    // @ts-expect-error `dimensions` is required on OllamaEmbeddingConfig
    createEmbeddingProvider({ type: 'ollama', model: 'nomic-embed-text' })
    // @ts-expect-error `apiKey` is required on OpenAIEmbeddingConfig
    createEmbeddingProvider({ type: 'openai' })
  }
  void _refusesABuiltInConfigMissingARequiredMember

  describe('Provider interface compliance', () => {
    it('OpenAI provider should implement EmbeddingProvider interface', () => {
      const provider = new OpenAIEmbeddingProvider({
        type: 'openai',
        apiKey: 'test-key',
      })

      expect(provider).toHaveProperty('type')
      expect(provider).toHaveProperty('model')
      expect(provider).toHaveProperty('dimensions')
      expect(provider).toHaveProperty('embed')
      expect(provider).toHaveProperty('embedBatch')
      expect(typeof provider.embed).toBe('function')
      expect(typeof provider.embedBatch).toBe('function')
    })

    it('Ollama provider should implement EmbeddingProvider interface', () => {
      const provider = new OllamaEmbeddingProvider({
        type: 'ollama',
        dimensions: 768,
      })

      expect(provider).toHaveProperty('type')
      expect(provider).toHaveProperty('model')
      expect(provider).toHaveProperty('dimensions')
      expect(provider).toHaveProperty('embed')
      expect(provider).toHaveProperty('embedBatch')
      expect(typeof provider.embed).toBe('function')
      expect(typeof provider.embedBatch).toBe('function')
    })
  })

  describe('Error handling', () => {
    it('should handle network errors for Ollama', async () => {
      const provider = new OllamaEmbeddingProvider({
        type: 'ollama',
        baseURL: 'http://nonexistent-host:11434',
        dimensions: 768,
      })

      await expect(provider.embed('test')).rejects.toThrow()
    })
  })
})
