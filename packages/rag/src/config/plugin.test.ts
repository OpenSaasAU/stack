import { describe, it, expect, vi } from 'vitest'
import { ragPlugin } from './plugin.js'
import type { RAGConfig } from './types.js'
import type { Plugin, PluginContext } from '@opensaas/stack-core'

describe('RAG Plugin', () => {
  describe('plugin creation', () => {
    it('should create plugin with minimal config', () => {
      const config: RAGConfig = {
        provider: {
          type: 'openai',
          apiKey: 'test-key',
        },
      }

      const plugin = ragPlugin(config)

      expect(plugin.name).toBe('rag')
      expect(plugin.version).toBe('0.1.0')
      expect(plugin.init).toBeDefined()
      expect(typeof plugin.init).toBe('function')
    })

    it('should create plugin with full config', () => {
      const config: RAGConfig = {
        provider: {
          type: 'openai',
          apiKey: 'test-key',
        },
        storage: {
          type: 'json',
        },
        enableMcpTools: true,
        batchSize: 20,
        rateLimit: 200,
      }

      const plugin = ragPlugin(config)

      expect(plugin).toBeDefined()
      expect(plugin.name).toBe('rag')
    })

    it('should create plugin with multiple providers', () => {
      const config: RAGConfig = {
        providers: {
          openai: {
            type: 'openai',
            apiKey: 'test-key',
          },
          ollama: {
            type: 'ollama',
            baseURL: 'http://localhost:11434',
          },
        },
        storage: {
          type: 'json',
        },
      }

      const plugin = ragPlugin(config)

      expect(plugin).toBeDefined()
      expect(plugin.name).toBe('rag')
    })
  })

  describe('plugin initialization', () => {
    it('should find and process embedding fields with autoGenerate', async () => {
      const config: RAGConfig = {
        provider: {
          type: 'openai',
          apiKey: 'test-key',
        },
      }

      const plugin = ragPlugin(config)

      const mockContext = {
        config: { db: { provider: 'sqlite', prismaClientConstructor: (() => null) as any },
          lists: {
            Article: {
              fields: {
                content: { type: 'text' },
                contentEmbedding: {
                  type: 'embedding',
                  sourceField: 'content',
                  autoGenerate: true,
                  provider: 'openai',
                  dimensions: 1536,
                },
              },
            },
          },
        },
        extendList: vi.fn(),
        setPluginData: vi.fn(),
        registerMcpTool: vi.fn(),
        addList: vi.fn(),
      } as PluginContext

      await plugin.init!(mockContext as PluginContext)

      expect(mockContext.extendList).toHaveBeenCalledWith(
        'Article',
        expect.objectContaining({
          hooks: expect.any(Object),
        }),
      )
    })

    it('should throw error if autoGenerate is enabled without sourceField', async () => {
      const config: RAGConfig = {
        provider: {
          type: 'openai',
          apiKey: 'test-key',
        },
      }

      const plugin = ragPlugin(config)

      const mockContext = {
        config: { db: { provider: 'sqlite', prismaClientConstructor: (() => null) as any },
          lists: {
            Article: {
              fields: {
                embedding: {
                  type: 'embedding',
                  autoGenerate: true,
                  // Missing sourceField
                },
              },
            },
          },
        },
        extendList: vi.fn(),
        setPluginData: vi.fn(),
        registerMcpTool: vi.fn(),
        addList: vi.fn(),
      } as PluginContext

      await expect(plugin.init!(mockContext as PluginContext)).rejects.toThrow(
        /has autoGenerate enabled but no sourceField specified/,
      )
    })

    it('should skip fields without autoGenerate', async () => {
      const config: RAGConfig = {
        provider: {
          type: 'openai',
          apiKey: 'test-key',
        },
      }

      const plugin = ragPlugin(config)

      const mockContext = {
        config: { db: { provider: 'sqlite', prismaClientConstructor: (() => null) as any },
          lists: {
            Article: {
              fields: {
                embedding: {
                  type: 'embedding',
                  // autoGenerate is false
                },
              },
            },
          },
        },
        extendList: vi.fn(),
        setPluginData: vi.fn(),
        registerMcpTool: vi.fn(),
        addList: vi.fn(),
      } as PluginContext

      await plugin.init!(mockContext as PluginContext)

      // Should not extend list for fields without autoGenerate
      expect(mockContext.extendList).not.toHaveBeenCalled()
    })

    it('should store normalized config in plugin data', async () => {
      const config: RAGConfig = {
        provider: {
          type: 'openai',
          apiKey: 'test-key',
        },
        storage: {
          type: 'json',
        },
      }

      const plugin = ragPlugin(config)

      const mockContext = {
        config: { db: { provider: 'sqlite', prismaClientConstructor: (() => null) as any },
          lists: {},
        },
        setPluginData: vi.fn(),
        registerMcpTool: vi.fn(),
        extendList: vi.fn(),
        addList: vi.fn(),
      } as PluginContext

      await plugin.init!(mockContext as PluginContext)

      expect(mockContext.setPluginData).toHaveBeenCalledWith(
        'rag',
        expect.objectContaining({
          provider: expect.any(Object),
          storage: expect.any(Object),
        }),
      )
    })
  })

  describe('automatic embedding generation', () => {
    it('should inject afterOperation hook for autoGenerate fields', async () => {
      const config: RAGConfig = {
        provider: {
          type: 'openai',
          apiKey: 'test-key',
        },
      }

      const plugin = ragPlugin(config)

      const mockContext = {
        config: { db: { provider: 'sqlite', prismaClientConstructor: (() => null) as any },
          lists: {
            Article: {
              fields: {
                content: { type: 'text' },
                contentEmbedding: {
                  type: 'embedding',
                  sourceField: 'content',
                  autoGenerate: true,
                },
              },
            },
          },
        },
        extendList: vi.fn(),
        setPluginData: vi.fn(),
        registerMcpTool: vi.fn(),
        addList: vi.fn(),
      } as PluginContext

      await plugin.init!(mockContext as PluginContext)

      expect(mockContext.extendList).toHaveBeenCalledWith(
        'Article',
        expect.objectContaining({
          hooks: expect.objectContaining({
            resolveInput: expect.any(Function),
          }),
        }),
      )
    })

    it('should handle multiple embedding fields in same list', async () => {
      const config: RAGConfig = {
        providers: {
          openai: { type: 'openai', apiKey: 'key1' },
          ollama: { type: 'ollama' },
        },
      }

      const plugin = ragPlugin(config)

      const mockContext = {
        config: { db: { provider: 'sqlite', prismaClientConstructor: (() => null) as any },
          lists: {
            Article: {
              fields: {
                title: { type: 'text' },
                content: { type: 'text' },
                titleEmbedding: {
                  type: 'embedding',
                  sourceField: 'title',
                  autoGenerate: true,
                  provider: 'ollama',
                },
                contentEmbedding: {
                  type: 'embedding',
                  sourceField: 'content',
                  autoGenerate: true,
                  provider: 'openai',
                },
              },
            },
          },
        },
        extendList: vi.fn(),
        setPluginData: vi.fn(),
        registerMcpTool: vi.fn(),
        addList: vi.fn(),
      } as PluginContext

      await plugin.init!(mockContext as PluginContext)

      // Should be called once per list (hooks are merged)
      expect(mockContext.extendList).toHaveBeenCalledTimes(2)
    })
  })

  describe('MCP integration', () => {
    it('should register MCP tools when enabled', async () => {
      const config: RAGConfig = {
        provider: {
          type: 'openai',
          apiKey: 'test-key',
        },
        enableMcpTools: true,
      }

      const plugin = ragPlugin(config)

      const mockContext = {
        config: { db: { provider: 'sqlite', prismaClientConstructor: (() => null) as any },
          lists: {
            Article: {
              fields: {
                contentEmbedding: {
                  type: 'embedding',
                },
              },
            },
          },
        },
        extendList: vi.fn(),
        setPluginData: vi.fn(),
        registerMcpTool: vi.fn(),
        addList: vi.fn(),
      } as PluginContext

      await plugin.init!(mockContext as PluginContext)

      expect(mockContext.registerMcpTool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'semantic_search_article',
          description: expect.stringContaining('Search Article'),
          inputSchema: expect.any(Object),
          handler: expect.any(Function),
        }),
      )
    })

    it('should not register MCP tools when disabled', async () => {
      const config: RAGConfig = {
        provider: {
          type: 'openai',
          apiKey: 'test-key',
        },
        enableMcpTools: false,
      }

      const plugin = ragPlugin(config)

      const mockContext = {
        config: { db: { provider: 'sqlite', prismaClientConstructor: (() => null) as any },
          lists: {
            Article: {
              fields: {
                contentEmbedding: {
                  type: 'embedding',
                },
              },
            },
          },
        },
        extendList: vi.fn(),
        setPluginData: vi.fn(),
        registerMcpTool: vi.fn(),
        addList: vi.fn(),
      } as PluginContext

      await plugin.init!(mockContext as PluginContext)

      expect(mockContext.registerMcpTool).not.toHaveBeenCalled()
    })

    it('should skip lists without embedding fields for MCP', async () => {
      const config: RAGConfig = {
        provider: {
          type: 'openai',
          apiKey: 'test-key',
        },
        enableMcpTools: true,
      }

      const plugin = ragPlugin(config)

      const mockContext = {
        config: { db: { provider: 'sqlite', prismaClientConstructor: (() => null) as any },
          lists: {
            User: {
              fields: {
                name: { type: 'text' },
                email: { type: 'text' },
              },
            },
          },
        },
        extendList: vi.fn(),
        setPluginData: vi.fn(),
        registerMcpTool: vi.fn(),
        addList: vi.fn(),
      } as PluginContext

      await plugin.init!(mockContext as PluginContext)

      expect(mockContext.registerMcpTool).not.toHaveBeenCalled()
    })

    it('should generate correct MCP tool names', async () => {
      const config: RAGConfig = {
        provider: {
          type: 'openai',
          apiKey: 'test-key',
        },
        enableMcpTools: true,
      }

      const plugin = ragPlugin(config)

      const mockContext = {
        config: { db: { provider: 'sqlite', prismaClientConstructor: (() => null) as any },
          lists: {
            BlogPost: {
              fields: {
                embedding: { type: 'embedding' },
              },
            },
            UserProfile: {
              fields: {
                embedding: { type: 'embedding' },
              },
            },
          },
        },
        extendList: vi.fn(),
        setPluginData: vi.fn(),
        registerMcpTool: vi.fn(),
        addList: vi.fn(),
      } as PluginContext

      await plugin.init!(mockContext as PluginContext)

      expect(mockContext.registerMcpTool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'semantic_search_blogpost',
        }),
      )

      expect(mockContext.registerMcpTool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'semantic_search_userprofile',
        }),
      )
    })

    it('should create tool with correct input schema', async () => {
      const config: RAGConfig = {
        provider: {
          type: 'openai',
          apiKey: 'test-key',
        },
        enableMcpTools: true,
      }

      const plugin = ragPlugin(config)

      const mockContext = {
        config: { db: { provider: 'sqlite', prismaClientConstructor: (() => null) as any },
          lists: {
            Article: {
              fields: {
                embedding1: { type: 'embedding' },
                embedding2: { type: 'embedding' },
              },
            },
          },
        },
        extendList: vi.fn(),
        setPluginData: vi.fn(),
        registerMcpTool: vi.fn(),
        addList: vi.fn(),
      } as PluginContext

      await plugin.init!(mockContext as PluginContext)

      const toolCall = (
        mockContext.registerMcpTool as unknown as {
          mock: { calls: [[{ inputSchema: unknown }]] }
        }
      ).mock.calls[0][0]

      expect(toolCall.inputSchema).toEqual(
        expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            query: expect.any(Object),
            limit: expect.any(Object),
            minScore: expect.any(Object),
            field: expect.objectContaining({
              enum: ['embedding1', 'embedding2'],
            }),
          }),
          required: ['query'],
        }),
      )
    })
  })

  describe('provider selection', () => {
    it('should use default provider when field does not specify one', async () => {
      const config: RAGConfig = {
        provider: {
          type: 'openai',
          apiKey: 'test-key',
        },
      }

      const plugin = ragPlugin(config)

      const mockContext = {
        config: { db: { provider: 'sqlite', prismaClientConstructor: (() => null) as any },
          lists: {
            Article: {
              fields: {
                embedding: {
                  type: 'embedding',
                  sourceField: 'content',
                  autoGenerate: true,
                  // No provider specified, should use default
                },
              },
            },
          },
        },
        extendList: vi.fn(),
        setPluginData: vi.fn(),
        registerMcpTool: vi.fn(),
        addList: vi.fn(),
      } as PluginContext

      await plugin.init!(mockContext as PluginContext)

      expect(mockContext.extendList).toHaveBeenCalled()
    })

    it('should use named provider when field specifies one', async () => {
      const config: RAGConfig = {
        providers: {
          openai: { type: 'openai', apiKey: 'key1' },
          ollama: { type: 'ollama' },
        },
      }

      const plugin = ragPlugin(config)

      const mockContext = {
        config: { db: { provider: 'sqlite', prismaClientConstructor: (() => null) as any },
          lists: {
            Article: {
              fields: {
                embedding: {
                  type: 'embedding',
                  sourceField: 'content',
                  autoGenerate: true,
                  provider: 'ollama', // Use named provider
                },
              },
            },
          },
        },
        extendList: vi.fn(),
        setPluginData: vi.fn(),
        registerMcpTool: vi.fn(),
        addList: vi.fn(),
      } as PluginContext

      await plugin.init!(mockContext as PluginContext)

      expect(mockContext.extendList).toHaveBeenCalled()
    })
  })

  describe('configuration normalization', () => {
    it('should apply default values', async () => {
      const config: RAGConfig = {
        provider: {
          type: 'openai',
          apiKey: 'test-key',
        },
      }

      const plugin = ragPlugin(config)

      const mockContext = {
        config: { db: { provider: 'sqlite', prismaClientConstructor: (() => null) as any },
          lists: {},
        },
        setPluginData: vi.fn(),
        registerMcpTool: vi.fn(),
        extendList: vi.fn(),
        addList: vi.fn(),
      } as PluginContext

      await plugin.init!(mockContext as PluginContext)

      const normalizedConfig = (
        mockContext.setPluginData as unknown as { mock: { calls: [[string, unknown]] } }
      ).mock.calls[0][1]

      expect(normalizedConfig).toMatchObject({
        enableMcpTools: expect.any(Boolean),
        batchSize: expect.any(Number),
        rateLimit: expect.any(Number),
        storage: expect.any(Object),
        chunking: expect.objectContaining({
          strategy: expect.any(String),
          maxTokens: expect.any(Number),
          overlap: expect.any(Number),
        }),
      })
    })
  })

  describe('plugin interface conformance', () => {
    it('should conform to Plugin interface', () => {
      const config: RAGConfig = {
        provider: {
          type: 'openai',
          apiKey: 'test-key',
        },
      }

      const plugin: Plugin = ragPlugin(config)

      expect(plugin.name).toBeDefined()
      expect(plugin.version).toBeDefined()
      expect(plugin.init).toBeDefined()
      expect(typeof plugin.name).toBe('string')
      expect(typeof plugin.version).toBe('string')
      expect(typeof plugin.init).toBe('function')
    })
  })
})
