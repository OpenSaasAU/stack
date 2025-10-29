import { describe, it, expect } from 'vitest'
import { createMcpHandlers } from '../src/runtime/handler.js'
import type { OpenSaasConfig } from '@opensaas/stack-core'

/**
 * Helper to extract field schemas from MCP tools
 */
async function getToolSchemas(config: OpenSaasConfig, toolName: string) {
  const mockAuth = {
    api: {
      getMcpSession: async () => ({ userId: 'test' }),
    },
  }
  const mockGetContext = () => ({ db: {}, session: null, prisma: {} })

  const handlers = createMcpHandlers({
    config,
    auth: mockAuth,
    getContext: mockGetContext,
  })

  const request = new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    }),
  })

  const response = await handlers.POST(request)
  const body = await response.json()
  const tool = body.result.tools.find((t: { name: string }) => t.name === toolName)
  return tool?.inputSchema
}

describe('Field to JSON Schema conversion', () => {
  describe('Text field', () => {
    it('should convert text field to JSON schema string type', async () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
        mcp: { enabled: true },
        lists: {
          Post: {
            fields: {
              title: { type: 'text', validation: { isRequired: true } },
              description: { type: 'text' },
            },
            access: { operation: { query: () => true } },
          },
        },
      }

      const schema = await getToolSchemas(config, 'list_post_create')

      expect(schema.properties.data.properties.title).toEqual({
        type: 'string',
      })
      expect(schema.properties.data.properties.description).toEqual({
        type: 'string',
      })
      expect(schema.properties.data.required).toContain('title')
      expect(schema.properties.data.required).not.toContain('description')
    })

    it('should include length constraints for text field', async () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
        mcp: { enabled: true },
        lists: {
          Post: {
            fields: {
              title: {
                type: 'text',
                validation: {
                  length: { min: 3, max: 100 },
                },
              },
            },
            access: { operation: { query: () => true } },
          },
        },
      }

      const schema = await getToolSchemas(config, 'list_post_create')

      expect(schema.properties.data.properties.title).toEqual({
        type: 'string',
        minLength: 3,
        maxLength: 100,
      })
    })
  })

  describe('Integer field', () => {
    it('should convert integer field to JSON schema number type', async () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
        mcp: { enabled: true },
        lists: {
          Post: {
            fields: {
              views: { type: 'integer', validation: { isRequired: true } },
              likes: { type: 'integer' },
            },
            access: { operation: { query: () => true } },
          },
        },
      }

      const schema = await getToolSchemas(config, 'list_post_create')

      expect(schema.properties.data.properties.views).toEqual({
        type: 'number',
      })
      expect(schema.properties.data.properties.likes).toEqual({
        type: 'number',
      })
      expect(schema.properties.data.required).toContain('views')
    })

    it('should include min/max constraints for integer field', async () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
        mcp: { enabled: true },
        lists: {
          Post: {
            fields: {
              rating: {
                type: 'integer',
                validation: { min: 1, max: 5 },
              },
            },
            access: { operation: { query: () => true } },
          },
        },
      }

      const schema = await getToolSchemas(config, 'list_post_create')

      expect(schema.properties.data.properties.rating).toEqual({
        type: 'number',
        minimum: 1,
        maximum: 5,
      })
    })
  })

  describe('Checkbox field', () => {
    it('should convert checkbox field to JSON schema boolean type', async () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
        mcp: { enabled: true },
        lists: {
          Post: {
            fields: {
              published: { type: 'checkbox' },
              featured: { type: 'checkbox' },
            },
            access: { operation: { query: () => true } },
          },
        },
      }

      const schema = await getToolSchemas(config, 'list_post_create')

      expect(schema.properties.data.properties.published).toEqual({
        type: 'boolean',
      })
      expect(schema.properties.data.properties.featured).toEqual({
        type: 'boolean',
      })
    })
  })

  describe('Timestamp field', () => {
    it('should convert timestamp field to JSON schema string with date-time format', async () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
        mcp: { enabled: true },
        lists: {
          Post: {
            fields: {
              publishedAt: { type: 'timestamp' },
              scheduledFor: { type: 'timestamp' },
            },
            access: { operation: { query: () => true } },
          },
        },
      }

      const schema = await getToolSchemas(config, 'list_post_create')

      expect(schema.properties.data.properties.publishedAt).toEqual({
        type: 'string',
        format: 'date-time',
      })
      expect(schema.properties.data.properties.scheduledFor).toEqual({
        type: 'string',
        format: 'date-time',
      })
    })
  })

  describe('Select field', () => {
    it('should convert select field to JSON schema with enum', async () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
        mcp: { enabled: true },
        lists: {
          Post: {
            fields: {
              status: {
                type: 'select',
                options: [
                  { label: 'Draft', value: 'draft' },
                  { label: 'Published', value: 'published' },
                  { label: 'Archived', value: 'archived' },
                ],
                validation: { isRequired: true },
              },
            },
            access: { operation: { query: () => true } },
          },
        },
      }

      const schema = await getToolSchemas(config, 'list_post_create')

      expect(schema.properties.data.properties.status).toEqual({
        type: 'string',
        enum: ['draft', 'published', 'archived'],
      })
      expect(schema.properties.data.required).toContain('status')
    })
  })

  describe('Password field', () => {
    it('should convert password field to JSON schema string type', async () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
        mcp: { enabled: true },
        lists: {
          User: {
            fields: {
              password: {
                type: 'password',
                validation: { isRequired: true, length: { min: 8 } },
              },
            },
            access: { operation: { query: () => true } },
          },
        },
      }

      const schema = await getToolSchemas(config, 'list_user_create')

      expect(schema.properties.data.properties.password).toEqual({
        type: 'string',
        minLength: 8,
      })
      expect(schema.properties.data.required).toContain('password')
    })
  })

  describe('Relationship field', () => {
    it('should convert relationship field to JSON schema object with connect', async () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
        mcp: { enabled: true },
        lists: {
          Post: {
            fields: {
              author: {
                type: 'relationship',
                ref: 'User.posts',
              },
            },
            access: { operation: { query: () => true } },
          },
          User: {
            fields: {
              name: { type: 'text' },
            },
            access: { operation: { query: () => true } },
            mcp: { enabled: false },
          },
        },
      }

      const schema = await getToolSchemas(config, 'list_post_create')

      expect(schema.properties.data.properties.author).toEqual({
        type: 'object',
        properties: {
          connect: {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
          },
        },
      })
    })
  })

  describe('System fields exclusion', () => {
    it('should exclude system fields from create/update schemas', async () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
        mcp: { enabled: true },
        lists: {
          Post: {
            fields: {
              title: { type: 'text' },
            },
            access: { operation: { query: () => true } },
          },
        },
      }

      const createSchema = await getToolSchemas(config, 'list_post_create')
      const updateSchema = await getToolSchemas(config, 'list_post_update')

      // System fields should not be in data properties
      expect(createSchema.properties.data.properties).not.toHaveProperty('id')
      expect(createSchema.properties.data.properties).not.toHaveProperty('createdAt')
      expect(createSchema.properties.data.properties).not.toHaveProperty('updatedAt')

      expect(updateSchema.properties.data.properties).not.toHaveProperty('id')
      expect(updateSchema.properties.data.properties).not.toHaveProperty('createdAt')
      expect(updateSchema.properties.data.properties).not.toHaveProperty('updatedAt')
    })
  })

  describe('Multiple field types', () => {
    it('should handle config with multiple field types', async () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
        mcp: { enabled: true },
        lists: {
          Article: {
            fields: {
              title: { type: 'text', validation: { isRequired: true, length: { max: 200 } } },
              content: { type: 'text' },
              published: { type: 'checkbox' },
              views: { type: 'integer', validation: { min: 0 } },
              status: {
                type: 'select',
                options: [
                  { label: 'Draft', value: 'draft' },
                  { label: 'Published', value: 'published' },
                ],
              },
              publishedAt: { type: 'timestamp' },
            },
            access: { operation: { query: () => true } },
          },
        },
      }

      const schema = await getToolSchemas(config, 'list_article_create')
      const dataProps = schema.properties.data.properties

      expect(dataProps.title).toEqual({ type: 'string', maxLength: 200 })
      expect(dataProps.content).toEqual({ type: 'string' })
      expect(dataProps.published).toEqual({ type: 'boolean' })
      expect(dataProps.views).toEqual({ type: 'number', minimum: 0 })
      expect(dataProps.status).toEqual({ type: 'string', enum: ['draft', 'published'] })
      expect(dataProps.publishedAt).toEqual({ type: 'string', format: 'date-time' })

      expect(schema.properties.data.required).toEqual(['title'])
    })
  })

  describe('Update vs Create schemas', () => {
    it('should not require fields in update schema', async () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
        mcp: { enabled: true },
        lists: {
          Post: {
            fields: {
              title: { type: 'text', validation: { isRequired: true } },
              content: { type: 'text', validation: { isRequired: true } },
            },
            access: { operation: { query: () => true } },
          },
        },
      }

      const createSchema = await getToolSchemas(config, 'list_post_create')
      const updateSchema = await getToolSchemas(config, 'list_post_update')

      // Create should require fields
      expect(createSchema.properties.data.required).toContain('title')
      expect(createSchema.properties.data.required).toContain('content')

      // Update should not require fields (all fields are optional)
      // The required field may be undefined or an empty array
      expect(updateSchema.properties.data.required || []).toEqual([])
    })
  })

  describe('Unknown field types', () => {
    it('should default to string type for unknown field types', async () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
        mcp: { enabled: true },
        lists: {
          Post: {
            fields: {
              customField: { type: 'custom-unknown-type' as never },
            },
            access: { operation: { query: () => true } },
          },
        },
      }

      const schema = await getToolSchemas(config, 'list_post_create')

      // Unknown types should default to string
      expect(schema.properties.data.properties.customField).toEqual({
        type: 'string',
      })
    })
  })
})
