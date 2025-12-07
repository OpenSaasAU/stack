/**
 * OpenSaaS Stack MCP Server - Main entry point
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { StackMCPServer } from './stack-mcp-server.js'

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: 'opensaas_implement_feature',
    description:
      'Start an interactive wizard to implement a complete feature (authentication, blog, comments, file-upload, semantic-search, or custom). Returns step-by-step guidance.',
    inputSchema: {
      type: 'object',
      properties: {
        feature: {
          type: 'string',
          description:
            'Feature to implement: "authentication", "blog", "comments", "file-upload", "semantic-search", or "custom"',
          enum: ['authentication', 'blog', 'comments', 'file-upload', 'semantic-search', 'custom'],
        },
        description: {
          type: 'string',
          description: 'Required if feature is "custom" - describe what you want to build',
        },
      },
      required: ['feature'],
    },
  },
  {
    name: 'opensaas_answer_feature',
    description:
      'Answer a question in the feature implementation wizard. Use this after opensaas_implement_feature to progress through the wizard.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID from the wizard',
        },
        answer: {
          description: 'Your answer to the current question',
          oneOf: [
            { type: 'string' },
            { type: 'boolean' },
            { type: 'array', items: { type: 'string' } },
          ],
        },
      },
      required: ['sessionId', 'answer'],
    },
  },
  {
    name: 'opensaas_answer_followup',
    description: 'Answer a follow-up question in the wizard flow',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID from the wizard',
        },
        answer: {
          type: 'string',
          description: 'Your answer to the follow-up question',
        },
      },
      required: ['sessionId', 'answer'],
    },
  },
  {
    name: 'opensaas_feature_docs',
    description:
      'Search OpenSaaS Stack documentation for a specific topic. Returns relevant docs with code examples.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description:
            'Topic to search for (e.g., "access control", "field types", "hooks", "authentication")',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'opensaas_list_features',
    description: 'List all available features that can be implemented with the wizard',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'opensaas_suggest_features',
    description: 'Get feature suggestions based on what features are already implemented',
    inputSchema: {
      type: 'object',
      properties: {
        currentFeatures: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of features already implemented (e.g., ["authentication", "blog"])',
        },
      },
    },
  },
  {
    name: 'opensaas_validate_feature',
    description: 'Validate that a feature is properly implemented according to best practices',
    inputSchema: {
      type: 'object',
      properties: {
        feature: {
          type: 'string',
          description: 'Feature to validate (e.g., "authentication")',
        },
        configPath: {
          type: 'string',
          description: 'Path to opensaas.config.ts (optional)',
        },
      },
      required: ['feature'],
    },
  },
  {
    name: 'opensaas_start_migration',
    description:
      'Start the migration wizard for an existing project. Returns the first question to begin the migration process.',
    inputSchema: {
      type: 'object',
      properties: {
        projectType: {
          type: 'string',
          description: 'Type of project being migrated',
          enum: ['prisma', 'keystone', 'nextjs'],
        },
      },
      required: ['projectType'],
    },
  },
  {
    name: 'opensaas_answer_migration',
    description:
      'Answer a question in the migration wizard. Use this after opensaas_start_migration to progress through the migration.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Migration session ID from the wizard',
        },
        answer: {
          description: 'Answer to the current question',
          oneOf: [
            { type: 'string' },
            { type: 'boolean' },
            { type: 'array', items: { type: 'string' } },
          ],
        },
      },
      required: ['sessionId', 'answer'],
    },
  },
  {
    name: 'opensaas_introspect_prisma',
    description:
      'Analyze a Prisma schema file and return detailed information about models, fields, and relationships. This helps you understand your existing schema before migration.',
    inputSchema: {
      type: 'object',
      properties: {
        schemaPath: {
          type: 'string',
          description: 'Path to schema.prisma (defaults to prisma/schema.prisma)',
        },
      },
    },
  },
  {
    name: 'opensaas_introspect_keystone',
    description:
      'Analyze a KeystoneJS config file and return information about lists and fields. This helps you understand your existing schema before migration.',
    inputSchema: {
      type: 'object',
      properties: {
        configPath: {
          type: 'string',
          description: 'Path to keystone.config.ts (defaults to keystone.config.ts)',
        },
      },
    },
  },
  {
    name: 'opensaas_search_migration_docs',
    description:
      'Search OpenSaaS Stack documentation for migration-related topics. Searches both local CLAUDE.md files and online documentation.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search query (e.g., "prisma to opensaas", "access control patterns", "field types")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'opensaas_get_example',
    description:
      'Get example code for a specific feature or pattern. Returns code snippets from the examples directory.',
    inputSchema: {
      type: 'object',
      properties: {
        feature: {
          type: 'string',
          description:
            'Feature to get example for (e.g., "blog-with-auth", "access-control", "relationships", "hooks", "custom-fields")',
        },
      },
      required: ['feature'],
    },
  },
]

/**
 * Create and start the MCP server
 */
export async function startMCPServer() {
  const server = new Server(
    {
      name: 'opensaas-stack-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  const stackServer = new StackMCPServer()

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS }
  })

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    try {
      switch (name) {
        case 'opensaas_implement_feature':
          return await stackServer.implementFeature(
            args as { feature: string; description?: string },
          )

        case 'opensaas_answer_feature':
          return await stackServer.answerFeatureQuestion(
            args as { sessionId: string; answer: string | boolean | string[] },
          )

        case 'opensaas_answer_followup':
          return await stackServer.answerFollowUpQuestion(
            args as { sessionId: string; answer: string },
          )

        case 'opensaas_feature_docs':
          return await stackServer.searchFeatureDocs(args as { topic: string })

        case 'opensaas_list_features':
          return await stackServer.listFeatures()

        case 'opensaas_suggest_features':
          return await stackServer.suggestFeatures(args as { currentFeatures?: string[] })

        case 'opensaas_validate_feature':
          return await stackServer.validateFeature(args as { feature: string; configPath?: string })

        case 'opensaas_start_migration':
          return await stackServer.startMigration(
            args as { projectType: 'prisma' | 'keystone' | 'nextjs' },
          )

        case 'opensaas_answer_migration':
          return await stackServer.answerMigration(
            args as { sessionId: string; answer: string | boolean | string[] },
          )

        case 'opensaas_introspect_prisma':
          return await stackServer.introspectPrisma(args as { schemaPath?: string })

        case 'opensaas_introspect_keystone':
          return await stackServer.introspectKeystone(args as { configPath?: string })

        case 'opensaas_search_migration_docs':
          return await stackServer.searchMigrationDocs(args as { query: string })

        case 'opensaas_get_example':
          return await stackServer.getExample(args as { feature: string })

        default:
          return {
            content: [
              {
                type: 'text' as const,
                text: `Unknown tool: ${name}`,
              },
            ],
            isError: true,
          }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`Error executing tool ${name}:`, error)

      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${errorMessage}`,
          },
        ],
        isError: true,
      }
    }
  })

  // Periodic cleanup
  setInterval(
    () => {
      stackServer.cleanup()
    },
    1000 * 60 * 15,
  ) // Every 15 minutes

  // Start server
  const transport = new StdioServerTransport()
  await server.connect(transport)

  console.error('OpenSaaS Stack MCP server running on stdio')
}

// Start if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startMCPServer().catch((error) => {
    console.error('Failed to start MCP server:', error)
    process.exit(1)
  })
}
