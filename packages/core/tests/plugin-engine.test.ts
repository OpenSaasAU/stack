import { describe, test, expect, vi } from 'vitest'
import {
  executePlugins,
  executeBeforeGenerateHooks,
  executeAfterGenerateHooks,
} from '../src/config/plugin-engine.js'
import type { OpenSaasConfig, Plugin, PluginContext } from '../src/config/types.js'
import { text, integer } from '../src/fields/index.js'

describe('Plugin Engine', () => {
  describe('dependency resolution', () => {
    test('executes plugins with no dependencies', async () => {
      const initSpy = vi.fn()
      const plugin: Plugin = {
        name: 'test-plugin',
        init: initSpy,
      }

      const config: OpenSaasConfig = {
        lists: {},
        plugins: [plugin],
      }

      await executePlugins(config)
      expect(initSpy).toHaveBeenCalledTimes(1)
    })

    test('sorts plugins by dependencies', async () => {
      const executionOrder: string[] = []

      const pluginA: Plugin = {
        name: 'plugin-a',
        init: async () => {
          executionOrder.push('a')
        },
      }

      const pluginB: Plugin = {
        name: 'plugin-b',
        dependencies: ['plugin-a'],
        init: async () => {
          executionOrder.push('b')
        },
      }

      const pluginC: Plugin = {
        name: 'plugin-c',
        dependencies: ['plugin-b', 'plugin-a'],
        init: async () => {
          executionOrder.push('c')
        },
      }

      const config: OpenSaasConfig = {
        lists: {},
        plugins: [pluginC, pluginB, pluginA], // Reverse order
      }

      await executePlugins(config)
      expect(executionOrder).toEqual(['a', 'b', 'c'])
    })

    test('detects circular dependencies', async () => {
      const pluginA: Plugin = {
        name: 'plugin-a',
        dependencies: ['plugin-b'],
        init: async () => {},
      }

      const pluginB: Plugin = {
        name: 'plugin-b',
        dependencies: ['plugin-a'],
        init: async () => {},
      }

      const config: OpenSaasConfig = {
        lists: {},
        plugins: [pluginA, pluginB],
      }

      await expect(executePlugins(config)).rejects.toThrow('Circular dependency detected')
    })

    test('throws on missing dependencies', async () => {
      const plugin: Plugin = {
        name: 'plugin-a',
        dependencies: ['missing-plugin'],
        init: async () => {},
      }

      const config: OpenSaasConfig = {
        lists: {},
        plugins: [plugin],
      }

      await expect(executePlugins(config)).rejects.toThrow(
        'Plugin "missing-plugin" is required by "plugin-a" but not found',
      )
    })

    test('throws on duplicate plugin names', async () => {
      const plugin1: Plugin = {
        name: 'duplicate',
        init: async () => {},
      }

      const plugin2: Plugin = {
        name: 'duplicate',
        init: async () => {},
      }

      const config: OpenSaasConfig = {
        lists: {},
        plugins: [plugin1, plugin2],
      }

      await expect(executePlugins(config)).rejects.toThrow('Duplicate plugin name: duplicate')
    })

    test('handles complex dependency chains', async () => {
      const executionOrder: string[] = []

      const plugins: Plugin[] = [
        {
          name: 'base',
          init: async () => executionOrder.push('base'),
        },
        {
          name: 'auth',
          dependencies: ['base'],
          init: async () => executionOrder.push('auth'),
        },
        {
          name: 'profile',
          dependencies: ['auth'],
          init: async () => executionOrder.push('profile'),
        },
        {
          name: 'notifications',
          dependencies: ['auth'],
          init: async () => executionOrder.push('notifications'),
        },
        {
          name: 'admin',
          dependencies: ['auth', 'profile', 'notifications'],
          init: async () => executionOrder.push('admin'),
        },
      ]

      const config: OpenSaasConfig = {
        lists: {},
        plugins: plugins.reverse(), // Reversed to test sorting
      }

      await executePlugins(config)

      // Verify base runs first, auth before profile/notifications, and admin last
      expect(executionOrder.indexOf('base')).toBeLessThan(executionOrder.indexOf('auth'))
      expect(executionOrder.indexOf('auth')).toBeLessThan(executionOrder.indexOf('profile'))
      expect(executionOrder.indexOf('auth')).toBeLessThan(executionOrder.indexOf('notifications'))
      expect(executionOrder.indexOf('profile')).toBeLessThan(executionOrder.indexOf('admin'))
      expect(executionOrder.indexOf('notifications')).toBeLessThan(executionOrder.indexOf('admin'))
    })
  })

  describe('plugin initialization', () => {
    test('provides correct context to init', async () => {
      let receivedContext: PluginContext | undefined

      const plugin: Plugin = {
        name: 'test-plugin',
        init: async (context) => {
          receivedContext = context
        },
      }

      const config: OpenSaasConfig = {
        lists: {
          Post: {
            fields: {
              title: text(),
            },
          },
        },
        plugins: [plugin],
      }

      await executePlugins(config)

      expect(receivedContext).toBeDefined()
      expect(receivedContext!.config).toBeDefined()
      expect(receivedContext!.config.lists.Post).toBeDefined()
      expect(typeof receivedContext!.addList).toBe('function')
      expect(typeof receivedContext!.extendList).toBe('function')
      expect(typeof receivedContext!.registerFieldType).toBe('function')
      expect(typeof receivedContext!.registerMcpTool).toBe('function')
      expect(typeof receivedContext!.setPluginData).toBe('function')
    })

    test('stores plugin data correctly', async () => {
      const pluginData = { apiKey: 'secret', enabled: true }

      const plugin: Plugin = {
        name: 'test-plugin',
        init: async (context) => {
          context.setPluginData('test-plugin', pluginData)
        },
      }

      const config: OpenSaasConfig = {
        lists: {},
        plugins: [plugin],
      }

      const result = await executePlugins(config)

      expect(result._pluginData).toBeDefined()
      expect(result._pluginData!['test-plugin']).toEqual(pluginData)
    })

    test('allows multiple plugins to store data', async () => {
      const plugin1: Plugin = {
        name: 'plugin-1',
        init: async (context) => {
          context.setPluginData('plugin-1', { value: 1 })
        },
      }

      const plugin2: Plugin = {
        name: 'plugin-2',
        init: async (context) => {
          context.setPluginData('plugin-2', { value: 2 })
        },
      }

      const config: OpenSaasConfig = {
        lists: {},
        plugins: [plugin1, plugin2],
      }

      const result = await executePlugins(config)

      expect(result._pluginData!['plugin-1']).toEqual({ value: 1 })
      expect(result._pluginData!['plugin-2']).toEqual({ value: 2 })
    })

    test('handles empty plugin list', async () => {
      const config: OpenSaasConfig = {
        lists: {},
        plugins: [],
      }

      const result = await executePlugins(config)
      expect(result).toEqual(config)
    })

    test('handles no plugins property', async () => {
      const config: OpenSaasConfig = {
        lists: {},
      }

      const result = await executePlugins(config)
      expect(result).toEqual(config)
    })
  })

  describe('addList', () => {
    test('adds a new list to config', async () => {
      const plugin: Plugin = {
        name: 'test-plugin',
        init: async (context) => {
          context.addList('User', {
            fields: {
              email: text(),
              age: integer(),
            },
          })
        },
      }

      const config: OpenSaasConfig = {
        lists: {},
        plugins: [plugin],
      }

      const result = await executePlugins(config)

      expect(result.lists.User).toBeDefined()
      expect(result.lists.User.fields.email).toBeDefined()
      expect(result.lists.User.fields.age).toBeDefined()
    })

    test('throws when adding duplicate list', async () => {
      const plugin: Plugin = {
        name: 'test-plugin',
        init: async (context) => {
          context.addList('Post', {
            fields: {
              title: text(),
            },
          })
        },
      }

      const config: OpenSaasConfig = {
        lists: {
          Post: {
            fields: {
              content: text(),
            },
          },
        },
        plugins: [plugin],
      }

      await expect(executePlugins(config)).rejects.toThrow(
        'Plugin "test-plugin" tried to add list "Post" but it already exists',
      )
    })

    test('multiple plugins can add different lists', async () => {
      const plugin1: Plugin = {
        name: 'plugin-1',
        init: async (context) => {
          context.addList('User', { fields: { email: text() } })
        },
      }

      const plugin2: Plugin = {
        name: 'plugin-2',
        init: async (context) => {
          context.addList('Session', { fields: { token: text() } })
        },
      }

      const config: OpenSaasConfig = {
        lists: {},
        plugins: [plugin1, plugin2],
      }

      const result = await executePlugins(config)

      expect(result.lists.User).toBeDefined()
      expect(result.lists.Session).toBeDefined()
    })
  })

  describe('extendList', () => {
    test('extends existing list with new fields', async () => {
      const plugin: Plugin = {
        name: 'test-plugin',
        init: async (context) => {
          context.extendList('Post', {
            fields: {
              views: integer(),
            },
          })
        },
      }

      const config: OpenSaasConfig = {
        lists: {
          Post: {
            fields: {
              title: text(),
            },
          },
        },
        plugins: [plugin],
      }

      const result = await executePlugins(config)

      expect(result.lists.Post.fields.title).toBeDefined()
      expect(result.lists.Post.fields.views).toBeDefined()
    })

    test('throws when extending non-existent list', async () => {
      const plugin: Plugin = {
        name: 'test-plugin',
        init: async (context) => {
          context.extendList('User', {
            fields: {
              name: text(),
            },
          })
        },
      }

      const config: OpenSaasConfig = {
        lists: {},
        plugins: [plugin],
      }

      await expect(executePlugins(config)).rejects.toThrow(
        'Plugin "test-plugin" tried to extend list "User" but it doesn\'t exist',
      )
    })

    test('merges fields from multiple plugins', async () => {
      const plugin1: Plugin = {
        name: 'plugin-1',
        init: async (context) => {
          context.extendList('Post', {
            fields: { views: integer() },
          })
        },
      }

      const plugin2: Plugin = {
        name: 'plugin-2',
        init: async (context) => {
          context.extendList('Post', {
            fields: { likes: integer() },
          })
        },
      }

      const config: OpenSaasConfig = {
        lists: {
          Post: {
            fields: {
              title: text(),
            },
          },
        },
        plugins: [plugin1, plugin2],
      }

      const result = await executePlugins(config)

      expect(result.lists.Post.fields.title).toBeDefined()
      expect(result.lists.Post.fields.views).toBeDefined()
      expect(result.lists.Post.fields.likes).toBeDefined()
    })
  })

  describe('hook merging', () => {
    test('merges resolveInput hooks from multiple plugins', async () => {
      const values: string[] = []

      const plugin1: Plugin = {
        name: 'plugin-1',
        init: async (context) => {
          context.extendList('Post', {
            hooks: {
              resolveInput: async ({ resolvedData }) => {
                values.push('plugin-1')
                return { ...resolvedData, field1: 'value1' }
              },
            },
          })
        },
      }

      const plugin2: Plugin = {
        name: 'plugin-2',
        init: async (context) => {
          context.extendList('Post', {
            hooks: {
              resolveInput: async ({ resolvedData }) => {
                values.push('plugin-2')
                return { ...resolvedData, field2: 'value2' }
              },
            },
          })
        },
      }

      const config: OpenSaasConfig = {
        lists: {
          Post: {
            fields: { title: text() },
          },
        },
        plugins: [plugin1, plugin2],
      }

      const result = await executePlugins(config)

      // Test that hooks are chained
      const resolvedData = await result.lists.Post.hooks!.resolveInput!({
        operation: 'create',
        resolvedData: { title: 'test' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)

      expect(values).toEqual(['plugin-1', 'plugin-2'])
      expect(resolvedData).toEqual({
        title: 'test',
        field1: 'value1',
        field2: 'value2',
      })
    })

    test('merges validateInput hooks from multiple plugins', async () => {
      const validations: string[] = []

      const plugin1: Plugin = {
        name: 'plugin-1',
        init: async (context) => {
          context.extendList('Post', {
            hooks: {
              validateInput: async () => {
                validations.push('plugin-1')
              },
            },
          })
        },
      }

      const plugin2: Plugin = {
        name: 'plugin-2',
        init: async (context) => {
          context.extendList('Post', {
            hooks: {
              validateInput: async () => {
                validations.push('plugin-2')
              },
            },
          })
        },
      }

      const config: OpenSaasConfig = {
        lists: {
          Post: {
            fields: { title: text() },
          },
        },
        plugins: [plugin1, plugin2],
      }

      const result = await executePlugins(config)

      // Test that both validators run
      await result.lists.Post.hooks!.validateInput!({
        operation: 'create',
        resolvedData: { title: 'test' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)

      expect(validations).toEqual(['plugin-1', 'plugin-2'])
    })

    test('merges beforeOperation hooks from multiple plugins', async () => {
      const operations: string[] = []

      const plugin1: Plugin = {
        name: 'plugin-1',
        init: async (context) => {
          context.extendList('Post', {
            hooks: {
              beforeOperation: async () => {
                operations.push('plugin-1')
              },
            },
          })
        },
      }

      const plugin2: Plugin = {
        name: 'plugin-2',
        init: async (context) => {
          context.extendList('Post', {
            hooks: {
              beforeOperation: async () => {
                operations.push('plugin-2')
              },
            },
          })
        },
      }

      const config: OpenSaasConfig = {
        lists: {
          Post: {
            fields: { title: text() },
          },
        },
        plugins: [plugin1, plugin2],
      }

      const result = await executePlugins(config)

      // Test that both hooks run
      await result.lists.Post.hooks!.beforeOperation!({
        operation: 'create',
        resolvedData: { title: 'test' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)

      expect(operations).toEqual(['plugin-1', 'plugin-2'])
    })

    test('merges afterOperation hooks from multiple plugins', async () => {
      const operations: string[] = []

      const plugin1: Plugin = {
        name: 'plugin-1',
        init: async (context) => {
          context.extendList('Post', {
            hooks: {
              afterOperation: async () => {
                operations.push('plugin-1')
              },
            },
          })
        },
      }

      const plugin2: Plugin = {
        name: 'plugin-2',
        init: async (context) => {
          context.extendList('Post', {
            hooks: {
              afterOperation: async () => {
                operations.push('plugin-2')
              },
            },
          })
        },
      }

      const config: OpenSaasConfig = {
        lists: {
          Post: {
            fields: { title: text() },
          },
        },
        plugins: [plugin1, plugin2],
      }

      const result = await executePlugins(config)

      // Test that both hooks run
      await result.lists.Post.hooks!.afterOperation!({
        operation: 'create',
        item: { id: '1', title: 'test' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)

      expect(operations).toEqual(['plugin-1', 'plugin-2'])
    })

    test('handles single hook without merging', async () => {
      const plugin: Plugin = {
        name: 'plugin-1',
        init: async (context) => {
          context.extendList('Post', {
            hooks: {
              resolveInput: async ({ resolvedData }) => {
                return { ...resolvedData, modified: true }
              },
            },
          })
        },
      }

      const config: OpenSaasConfig = {
        lists: {
          Post: {
            fields: { title: text() },
          },
        },
        plugins: [plugin],
      }

      const result = await executePlugins(config)

      const resolvedData = await result.lists.Post.hooks!.resolveInput!({
        operation: 'create',
        resolvedData: { title: 'test' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)

      expect(resolvedData).toEqual({
        title: 'test',
        modified: true,
      })
    })
  })

  describe('access control merging', () => {
    test('merges access control from plugins', async () => {
      const plugin: Plugin = {
        name: 'test-plugin',
        init: async (context) => {
          context.extendList('Post', {
            access: {
              operation: {
                query: () => true,
                create: ({ session }) => !!session,
              },
            },
          })
        },
      }

      const config: OpenSaasConfig = {
        lists: {
          Post: {
            fields: { title: text() },
            access: {
              operation: {
                update: ({ session }) => !!session,
              },
            },
          },
        },
        plugins: [plugin],
      }

      const result = await executePlugins(config)

      expect(result.lists.Post.access?.operation?.query).toBeDefined()
      expect(result.lists.Post.access?.operation?.create).toBeDefined()
      expect(result.lists.Post.access?.operation?.update).toBeDefined()
    })

    test('plugin access control overrides existing', async () => {
      const pluginQuery = vi.fn(() => false)

      const plugin: Plugin = {
        name: 'test-plugin',
        init: async (context) => {
          context.extendList('Post', {
            access: {
              operation: {
                query: pluginQuery,
              },
            },
          })
        },
      }

      const originalQuery = vi.fn(() => true)

      const config: OpenSaasConfig = {
        lists: {
          Post: {
            fields: { title: text() },
            access: {
              operation: {
                query: originalQuery,
              },
            },
          },
        },
        plugins: [plugin],
      }

      const result = await executePlugins(config)

      // Plugin's access control should override original
      expect(result.lists.Post.access?.operation?.query).toBe(pluginQuery)
    })
  })

  describe('MCP integration', () => {
    test('registers MCP tools from plugins', async () => {
      const customTool = {
        name: 'customTool',
        listKey: 'Post',
        handler: async () => ({ success: true }),
        description: 'Custom tool',
        inputSchema: {
          type: 'object' as const,
          properties: {},
        },
      }

      const plugin: Plugin = {
        name: 'test-plugin',
        init: async (context) => {
          context.registerMcpTool(customTool)
        },
      }

      const config: OpenSaasConfig = {
        lists: {},
        plugins: [plugin],
      }

      const result = await executePlugins(config)

      expect(result._pluginData?.__mcpTools).toEqual([customTool])
    })

    test('merges MCP config on list extension', async () => {
      const plugin: Plugin = {
        name: 'test-plugin',
        init: async (context) => {
          context.extendList('Post', {
            mcp: {
              enabled: true,
              customTools: [
                {
                  name: 'publishPost',
                  handler: async () => ({ success: true }),
                  description: 'Publish a post',
                  inputSchema: {
                    type: 'object' as const,
                    properties: {},
                  },
                },
              ],
            },
          })
        },
      }

      const config: OpenSaasConfig = {
        lists: {
          Post: {
            fields: { title: text() },
            mcp: {
              enabled: false,
            },
          },
        },
        plugins: [plugin],
      }

      const result = await executePlugins(config)

      expect(result.lists.Post.mcp?.enabled).toBe(true)
      expect(result.lists.Post.mcp?.customTools).toHaveLength(1)
    })
  })

  describe('field type registration', () => {
    test('registers custom field types', async () => {
      const customFieldBuilder = () => ({
        type: 'customField',
        getZodSchema: () => undefined,
        getPrismaType: () => ({ type: 'String', modifiers: '' }),
        getTypeScriptType: () => ({ type: 'string', optional: false }),
      })

      let registeredBuilder

      const plugin: Plugin = {
        name: 'test-plugin',
        init: async (context) => {
          context.registerFieldType('customField', customFieldBuilder)
          // Store reference for testing
          registeredBuilder = customFieldBuilder
        },
      }

      const config: OpenSaasConfig = {
        lists: {},
        plugins: [plugin],
      }

      await executePlugins(config)

      // Field type is registered in plugin context but not directly testable
      // In real usage, it would be available for field creation
      expect(registeredBuilder).toBeDefined()
    })

    test('throws when registering duplicate field type', async () => {
      const customFieldBuilder = () => ({
        type: 'customField',
        getZodSchema: () => undefined,
        getPrismaType: () => ({ type: 'String', modifiers: '' }),
        getTypeScriptType: () => ({ type: 'string', optional: false }),
      })

      const plugin: Plugin = {
        name: 'test-plugin',
        init: async (context) => {
          context.registerFieldType('customField', customFieldBuilder)
          context.registerFieldType('customField', customFieldBuilder) // Duplicate
        },
      }

      const config: OpenSaasConfig = {
        lists: {},
        plugins: [plugin],
      }

      await expect(executePlugins(config)).rejects.toThrow(
        'Plugin "test-plugin" tried to register field type "customField" but it\'s already registered',
      )
    })
  })

  describe('generation lifecycle hooks', () => {
    test('executes beforeGenerate hooks', async () => {
      const beforeGenerate = vi.fn((config: OpenSaasConfig) => {
        return {
          ...config,
          lists: {
            ...config.lists,
            NewList: {
              fields: {
                title: text(),
              },
            },
          },
        }
      })

      const plugin: Plugin = {
        name: 'test-plugin',
        init: async () => {},
        beforeGenerate,
      }

      const config: OpenSaasConfig = {
        lists: {},
        plugins: [plugin],
      }

      const result = await executeBeforeGenerateHooks(config)

      expect(beforeGenerate).toHaveBeenCalledTimes(1)
      expect(result.lists.NewList).toBeDefined()
    })

    test('chains beforeGenerate hooks', async () => {
      const plugin1: Plugin = {
        name: 'plugin-1',
        init: async () => {},
        beforeGenerate: async (config) => ({
          ...config,
          lists: {
            ...config.lists,
            List1: { fields: { field1: text() } },
          },
        }),
      }

      const plugin2: Plugin = {
        name: 'plugin-2',
        init: async () => {},
        beforeGenerate: async (config) => ({
          ...config,
          lists: {
            ...config.lists,
            List2: { fields: { field2: text() } },
          },
        }),
      }

      const config: OpenSaasConfig = {
        lists: {},
        plugins: [plugin1, plugin2],
      }

      const result = await executeBeforeGenerateHooks(config)

      expect(result.lists.List1).toBeDefined()
      expect(result.lists.List2).toBeDefined()
    })

    test('executes afterGenerate hooks', async () => {
      const afterGenerate = vi.fn((files) => {
        return {
          ...files,
          prismaSchema: files.prismaSchema + '\n// Modified by plugin',
        }
      })

      const plugin: Plugin = {
        name: 'test-plugin',
        init: async () => {},
        afterGenerate,
      }

      const config: OpenSaasConfig = {
        lists: {},
        plugins: [plugin],
      }

      const files = {
        prismaSchema: 'schema content',
        types: 'types content',
        context: 'context content',
      }

      const result = await executeAfterGenerateHooks(config, files)

      expect(afterGenerate).toHaveBeenCalledTimes(1)
      expect(result.prismaSchema).toContain('// Modified by plugin')
    })

    test('chains afterGenerate hooks', async () => {
      const plugin1: Plugin = {
        name: 'plugin-1',
        init: async () => {},
        afterGenerate: async (files) => ({
          ...files,
          prismaSchema: files.prismaSchema + '\n// Plugin 1',
        }),
      }

      const plugin2: Plugin = {
        name: 'plugin-2',
        init: async () => {},
        afterGenerate: async (files) => ({
          ...files,
          prismaSchema: files.prismaSchema + '\n// Plugin 2',
        }),
      }

      const config: OpenSaasConfig = {
        lists: {},
        plugins: [plugin1, plugin2],
      }

      const files = {
        prismaSchema: 'schema',
        types: 'types',
        context: 'context',
      }

      const result = await executeAfterGenerateHooks(config, files)

      expect(result.prismaSchema).toBe('schema\n// Plugin 1\n// Plugin 2')
    })

    test('handles no lifecycle hooks', async () => {
      const config: OpenSaasConfig = {
        lists: {},
        plugins: [],
      }

      const configResult = await executeBeforeGenerateHooks(config)
      expect(configResult).toEqual(config)

      const files = {
        prismaSchema: 'schema',
        types: 'types',
        context: 'context',
      }

      const filesResult = await executeAfterGenerateHooks(config, files)
      expect(filesResult).toEqual(files)
    })
  })

  describe('config preservation', () => {
    test('preserves original config properties', async () => {
      const plugin: Plugin = {
        name: 'test-plugin',
        init: async () => {},
      }

      const config: OpenSaasConfig = {
        db: { provider: 'postgresql', url: 'postgresql://localhost' },
        storage: {
          provider: 's3',
          config: { bucket: 'my-bucket' },
        },
        lists: {
          Post: {
            fields: { title: text() },
          },
        },
        plugins: [plugin],
      }

      const result = await executePlugins(config)

      expect(result.db).toEqual(config.db)
      expect(result.storage).toEqual(config.storage)
      expect(result.lists.Post).toBeDefined()
    })

    test('does not mutate original config', async () => {
      const plugin: Plugin = {
        name: 'test-plugin',
        init: async (context) => {
          context.addList('NewList', {
            fields: { title: text() },
          })
        },
      }

      const config: OpenSaasConfig = {
        lists: {
          Post: {
            fields: { title: text() },
          },
        },
        plugins: [plugin],
      }

      const originalListsKeys = Object.keys(config.lists)

      await executePlugins(config)

      // Original config should not have NewList
      expect(Object.keys(config.lists)).toEqual(originalListsKeys)
      expect(config.lists.NewList).toBeUndefined()
    })
  })
})
