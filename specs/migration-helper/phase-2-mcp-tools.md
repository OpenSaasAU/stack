# Phase 2: MCP Server Tools & Documentation Provider

## Task Overview

Extend the existing MCP server with migration-specific tools and enhance the documentation provider to search local docs and examples.

## Context

### Existing MCP Server Architecture

The MCP server is located in `packages/cli/src/mcp/`. It uses the `@modelcontextprotocol/sdk` to provide tools that Claude Code can call.

**Entry Point:** `packages/cli/src/mcp/server/index.ts`

```typescript
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
    description: 'Start an interactive wizard...',
    inputSchema: {
      type: 'object',
      properties: {
        feature: { type: 'string', description: '...' },
      },
      required: ['feature'],
    },
  },
  // ... more tools
]

export async function startMCPServer() {
  const server = new Server(/* ... */)
  const stackServer = new StackMCPServer()

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    switch (name) {
      case 'opensaas_implement_feature':
        return await stackServer.implementFeature(args)
      // ... more cases
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
```

**Business Logic:** `packages/cli/src/mcp/server/stack-mcp-server.ts`

```typescript
import { WizardEngine } from '../lib/wizards/wizard-engine.js'
import { OpenSaasDocumentationProvider } from '../lib/documentation-provider.js'

export class StackMCPServer {
  private wizardEngine: WizardEngine
  private docsProvider: OpenSaasDocumentationProvider

  constructor() {
    this.wizardEngine = new WizardEngine()
    this.docsProvider = new OpenSaasDocumentationProvider()
  }

  async implementFeature({ feature, description }) { /* ... */ }
  async answerFeatureQuestion({ sessionId, answer }) { /* ... */ }
  async searchFeatureDocs({ topic }) { /* ... */ }
  // ... more methods
}
```

### Existing Documentation Provider

Located at `packages/cli/src/mcp/lib/documentation-provider.ts`:

```typescript
export class OpenSaasDocumentationProvider {
  private readonly DOCS_API = 'https://stack.opensaas.au/api/search'
  private cache = new Map<string, { data: DocumentationLookup; timestamp: number }>()

  async searchDocs(query: string, limit = 5, minScore = 0.7): Promise<DocumentationLookup> {
    // Fetches from hosted docs API
  }

  async getTopicDocs(topic: string): Promise<DocumentationLookup> {
    // Normalizes topic and searches
  }
}
```

### MCP Response Format

All tools return this format:

```typescript
{
  content: [
    {
      type: 'text' as const,
      text: 'Response message here with **markdown** formatting',
    },
  ],
}
```

---

## Requirements

### 1. Add New Migration Tools

Add these tools to the MCP server:

| Tool Name | Description | Parameters |
|-----------|-------------|------------|
| `opensaas_start_migration` | Start migration wizard | `projectType: 'prisma' \| 'keystone' \| 'nextjs'` |
| `opensaas_answer_migration` | Answer migration question | `sessionId: string, answer: any` |
| `opensaas_introspect_prisma` | Analyze Prisma schema | `schemaPath?: string` (defaults to `prisma/schema.prisma`) |
| `opensaas_introspect_keystone` | Analyze KeystoneJS config | `configPath?: string` |
| `opensaas_search_migration_docs` | Search migration docs | `query: string` |
| `opensaas_get_example` | Get example config code | `feature: string` |

### 2. Enhance Documentation Provider

Add methods for local documentation:

- `searchLocalDocs(query)` - Search CLAUDE.md files
- `getExampleConfig(feature)` - Get example opensaas.config.ts snippets
- `findMigrationGuide(projectType)` - Get migration-specific docs

### 3. Wire Everything Together

Update `stack-mcp-server.ts` to handle new tools.

---

## File Changes

### 1. Modify `packages/cli/src/mcp/server/index.ts`

Add new tool definitions to the `TOOLS` array:

```typescript
// Add to TOOLS array

{
  name: 'opensaas_start_migration',
  description: 'Start the migration wizard for an existing project. Returns the first question.',
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
  description: 'Answer a question in the migration wizard',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Migration session ID',
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
  description: 'Analyze a Prisma schema file and return detailed information about models, fields, and relationships',
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
  description: 'Analyze a KeystoneJS config file and return information about lists and fields',
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
  description: 'Search OpenSaaS Stack documentation for migration-related topics',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (e.g., "prisma to opensaas", "access control patterns")',
      },
    },
    required: ['query'],
  },
},
{
  name: 'opensaas_get_example',
  description: 'Get example code for a specific feature or pattern',
  inputSchema: {
    type: 'object',
    properties: {
      feature: {
        type: 'string',
        description: 'Feature to get example for (e.g., "blog-with-auth", "access-control", "relationships")',
      },
    },
    required: ['feature'],
  },
},
```

Add to the switch statement in `CallToolRequestSchema` handler:

```typescript
case 'opensaas_start_migration':
  return await stackServer.startMigration(
    args as { projectType: 'prisma' | 'keystone' | 'nextjs' }
  )

case 'opensaas_answer_migration':
  return await stackServer.answerMigration(
    args as { sessionId: string; answer: string | boolean | string[] }
  )

case 'opensaas_introspect_prisma':
  return await stackServer.introspectPrisma(
    args as { schemaPath?: string }
  )

case 'opensaas_introspect_keystone':
  return await stackServer.introspectKeystone(
    args as { configPath?: string }
  )

case 'opensaas_search_migration_docs':
  return await stackServer.searchMigrationDocs(
    args as { query: string }
  )

case 'opensaas_get_example':
  return await stackServer.getExample(
    args as { feature: string }
  )
```

### 2. Modify `packages/cli/src/mcp/server/stack-mcp-server.ts`

Add new methods to the `StackMCPServer` class:

```typescript
import { MigrationWizard } from '../lib/wizards/migration-wizard.js'
import { PrismaIntrospector } from '../../migration/introspectors/prisma-introspector.js'
import { KeystoneIntrospector } from '../../migration/introspectors/keystone-introspector.js'
import type { ProjectType } from '../../migration/types.js'

export class StackMCPServer {
  private wizardEngine: WizardEngine
  private migrationWizard: MigrationWizard
  private docsProvider: OpenSaasDocumentationProvider
  private prismaIntrospector: PrismaIntrospector
  private keystoneIntrospector: KeystoneIntrospector

  constructor() {
    this.wizardEngine = new WizardEngine()
    this.migrationWizard = new MigrationWizard()
    this.docsProvider = new OpenSaasDocumentationProvider()
    this.prismaIntrospector = new PrismaIntrospector()
    this.keystoneIntrospector = new KeystoneIntrospector()
  }

  // ... existing methods ...

  /**
   * Start a migration wizard session
   */
  async startMigration({ projectType }: { projectType: ProjectType }) {
    return this.migrationWizard.startMigration(projectType)
  }

  /**
   * Answer a migration wizard question
   */
  async answerMigration({
    sessionId,
    answer,
  }: {
    sessionId: string
    answer: string | boolean | string[]
  }) {
    return this.migrationWizard.answerQuestion(sessionId, answer)
  }

  /**
   * Introspect a Prisma schema
   */
  async introspectPrisma({ schemaPath }: { schemaPath?: string }) {
    const cwd = process.cwd()
    const path = schemaPath || 'prisma/schema.prisma'

    try {
      const schema = await this.prismaIntrospector.introspect(cwd, path)

      const modelList = schema.models
        .map(m => {
          const fields = m.fields.map(f => {
            let type = f.type
            if (f.relation) type = `→ ${f.relation.model}`
            if (f.isList) type = `${type}[]`
            if (!f.isRequired) type = `${type}?`
            return `    - ${f.name}: ${type}`
          }).join('\n')
          return `### ${m.name}\n${fields}`
        })
        .join('\n\n')

      const enumList = schema.enums.length > 0
        ? `\n## Enums\n\n${schema.enums.map(e => `- **${e.name}**: ${e.values.join(', ')}`).join('\n')}`
        : ''

      return {
        content: [
          {
            type: 'text' as const,
            text: `# Prisma Schema Analysis

**Provider:** ${schema.provider}
**Models:** ${schema.models.length}
**Enums:** ${schema.enums.length}

## Models

${modelList}
${enumList}

---

**Ready to migrate?** Use \`opensaas_start_migration({ projectType: "prisma" })\` to begin the wizard.`,
          },
        ],
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        content: [
          {
            type: 'text' as const,
            text: `❌ Failed to introspect Prisma schema: ${message}\n\nMake sure the file exists at: ${path}`,
          },
        ],
        isError: true,
      }
    }
  }

  /**
   * Introspect a KeystoneJS config
   */
  async introspectKeystone({ configPath }: { configPath?: string }) {
    const cwd = process.cwd()
    const path = configPath || 'keystone.config.ts'

    try {
      const config = await this.keystoneIntrospector.introspect(cwd, path)

      return {
        content: [
          {
            type: 'text' as const,
            text: `# KeystoneJS Config Analysis

**Lists:** ${config.lists.length}

## Lists

${config.lists.map(l => `### ${l.name}\n${l.fields.map(f => `- ${f.name}: ${f.type}`).join('\n')}`).join('\n\n')}

---

**Note:** KeystoneJS → OpenSaaS migration is mostly 1:1. Field types and access control patterns map directly.

**Ready to migrate?** Use \`opensaas_start_migration({ projectType: "keystone" })\` to begin.`,
          },
        ],
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        content: [
          {
            type: 'text' as const,
            text: `❌ Failed to introspect KeystoneJS config: ${message}\n\nMake sure the file exists at: ${path}`,
          },
        ],
        isError: true,
      }
    }
  }

  /**
   * Search migration documentation
   */
  async searchMigrationDocs({ query }: { query: string }) {
    // First try local CLAUDE.md files
    const localDocs = await this.docsProvider.searchLocalDocs(query)

    // Then try hosted docs
    const hostedDocs = await this.docsProvider.searchDocs(query)

    const sections: string[] = []

    if (localDocs.content) {
      sections.push(`## Local Documentation\n\n${localDocs.content}`)
    }

    if (hostedDocs.content && hostedDocs.content !== 'No documentation found for this query.') {
      sections.push(`## Online Documentation\n\n${hostedDocs.content}`)
    }

    if (sections.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No documentation found for "${query}".

Try these searches:
- "access control" - How to restrict access to data
- "field types" - Available field types in OpenSaaS
- "authentication" - Setting up auth with Better-auth
- "hooks" - Data transformation and side effects

Or visit: https://stack.opensaas.au/`,
          },
        ],
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `# Documentation: ${query}\n\n${sections.join('\n\n---\n\n')}`,
        },
      ],
    }
  }

  /**
   * Get example code for a feature
   */
  async getExample({ feature }: { feature: string }) {
    const example = await this.docsProvider.getExampleConfig(feature)

    if (!example) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No example found for "${feature}".

Available examples:
- **blog-with-auth** - Blog with user authentication
- **access-control** - Access control patterns
- **relationships** - Model relationships
- **hooks** - Data transformation hooks
- **custom-fields** - Custom field types

Use: \`opensaas_get_example({ feature: "example-name" })\``,
          },
        ],
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `# Example: ${feature}

${example.description}

\`\`\`typescript
${example.code}
\`\`\`

${example.notes ? `\n## Notes\n\n${example.notes}` : ''}

---

📚 Full example at: ${example.sourcePath}`,
        },
      ],
    }
  }
}
```

### 3. Modify `packages/cli/src/mcp/lib/documentation-provider.ts`

Add new methods for local documentation:

```typescript
import fs from 'fs-extra'
import path from 'path'
import { glob } from 'glob'

interface LocalDocResult {
  content: string
  files: string[]
}

interface ExampleConfig {
  description: string
  code: string
  notes?: string
  sourcePath: string
}

export class OpenSaasDocumentationProvider {
  // ... existing code ...

  /**
   * Search local CLAUDE.md files in the monorepo
   */
  async searchLocalDocs(query: string): Promise<LocalDocResult> {
    const cwd = process.cwd()

    // Find CLAUDE.md files
    const claudeFiles = await glob('**/CLAUDE.md', {
      cwd,
      ignore: ['node_modules/**', '.next/**', 'dist/**'],
      absolute: true,
    })

    const results: Array<{ file: string; content: string; score: number }> = []
    const queryLower = query.toLowerCase()
    const queryTerms = queryLower.split(/\s+/)

    for (const file of claudeFiles) {
      try {
        const content = await fs.readFile(file, 'utf-8')
        const contentLower = content.toLowerCase()

        // Simple relevance scoring
        let score = 0
        for (const term of queryTerms) {
          if (contentLower.includes(term)) {
            score += (contentLower.match(new RegExp(term, 'g')) || []).length
          }
        }

        if (score > 0) {
          // Extract relevant section
          const lines = content.split('\n')
          const relevantLines: string[] = []
          let inRelevantSection = false
          let sectionHeader = ''

          for (const line of lines) {
            const lineLower = line.toLowerCase()

            // Check if line starts a section
            if (line.startsWith('#')) {
              // Check if this section title is relevant
              const titleRelevant = queryTerms.some(term => lineLower.includes(term))
              if (titleRelevant) {
                inRelevantSection = true
                sectionHeader = line
                relevantLines.push(line)
              } else if (inRelevantSection) {
                // We've left the relevant section
                break
              }
            } else if (inRelevantSection) {
              relevantLines.push(line)
            } else if (queryTerms.some(term => lineLower.includes(term))) {
              // Found relevant content outside a section
              relevantLines.push(line)
            }
          }

          if (relevantLines.length > 0) {
            results.push({
              file: path.relative(cwd, file),
              content: relevantLines.slice(0, 50).join('\n'),
              score,
            })
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score)

    if (results.length === 0) {
      return { content: '', files: [] }
    }

    const content = results
      .slice(0, 3)
      .map(r => `### From \`${r.file}\`\n\n${r.content}`)
      .join('\n\n---\n\n')

    return {
      content,
      files: results.map(r => r.file),
    }
  }

  /**
   * Get example config code for a feature
   */
  async getExampleConfig(feature: string): Promise<ExampleConfig | null> {
    const examples: Record<string, ExampleConfig> = {
      'blog-with-auth': {
        description: 'A blog application with user authentication and post management',
        code: `import { config, list } from '@opensaas/stack-core'
import { text, relationship, timestamp, select } from '@opensaas/stack-core/fields'
import { withAuth, authConfig } from '@opensaas/stack-auth'

const isAuthor = ({ session, item }) =>
  session?.userId === item?.authorId

export default withAuth(
  config({
    db: {
      provider: 'sqlite',
      url: 'file:./dev.db',
      prismaClientConstructor: (PrismaClient) => {
        // ... adapter setup
      },
    },
    lists: {
      Post: list({
        fields: {
          title: text({ validation: { isRequired: true } }),
          content: text({ ui: { displayMode: 'textarea' } }),
          status: select({
            options: [
              { label: 'Draft', value: 'draft' },
              { label: 'Published', value: 'published' },
            ],
            defaultValue: 'draft',
          }),
          author: relationship({ ref: 'User.posts' }),
          publishedAt: timestamp(),
        },
        access: {
          operation: {
            query: () => true,
            create: ({ session }) => !!session,
            update: isAuthor,
            delete: isAuthor,
          },
        },
      }),
    },
  }),
  authConfig({ emailAndPassword: { enabled: true } })
)`,
        notes: 'This example uses the auth plugin for user management. The `isAuthor` helper restricts updates to the post creator.',
        sourcePath: 'examples/auth-demo/opensaas.config.ts',
      },

      'access-control': {
        description: 'Common access control patterns for different scenarios',
        code: `// Public read, authenticated write
access: {
  operation: {
    query: () => true,
    create: ({ session }) => !!session,
    update: ({ session }) => !!session,
    delete: ({ session }) => !!session,
  },
}

// Only owners can access
const isOwner = ({ session, item }) =>
  session?.userId === item?.userId

access: {
  operation: {
    query: isOwner,
    update: isOwner,
    delete: isOwner,
  },
  filter: {
    query: ({ session }) => ({ userId: { equals: session?.userId } }),
  },
}

// Role-based access
const isAdmin = ({ session }) => session?.role === 'admin'
const isOwnerOrAdmin = (args) => isOwner(args) || isAdmin(args)

access: {
  operation: {
    query: () => true,
    create: ({ session }) => !!session,
    update: isOwnerOrAdmin,
    delete: isAdmin,
  },
}`,
        notes: 'Access control functions receive session and item context. Use filter access to automatically scope queries.',
        sourcePath: 'packages/core/CLAUDE.md',
      },

      'relationships': {
        description: 'How to define relationships between models',
        code: `lists: {
  User: list({
    fields: {
      name: text(),
      email: text({ isIndexed: 'unique' }),
      posts: relationship({ ref: 'Post.author', many: true }),
      comments: relationship({ ref: 'Comment.author', many: true }),
    },
  }),

  Post: list({
    fields: {
      title: text(),
      content: text(),
      author: relationship({ ref: 'User.posts' }),
      comments: relationship({ ref: 'Comment.post', many: true }),
      tags: relationship({ ref: 'Tag.posts', many: true }),
    },
  }),

  Comment: list({
    fields: {
      content: text(),
      author: relationship({ ref: 'User.comments' }),
      post: relationship({ ref: 'Post.comments' }),
    },
  }),

  Tag: list({
    fields: {
      name: text(),
      posts: relationship({ ref: 'Post.tags', many: true }),
    },
  }),
}`,
        notes: 'Relationships use `ref: "ListName.fieldName"` format. Set `many: true` for one-to-many or many-to-many.',
        sourcePath: 'examples/blog/opensaas.config.ts',
      },

      'hooks': {
        description: 'Data transformation and side effect hooks',
        code: `Post: list({
  fields: {
    title: text(),
    slug: text(),
    status: select({
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
      ],
    }),
    publishedAt: timestamp(),
  },
  hooks: {
    resolveInput: async ({ resolvedData, operation }) => {
      // Auto-generate slug from title
      if (resolvedData.title && !resolvedData.slug) {
        resolvedData.slug = resolvedData.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
      }

      // Set publishedAt when status changes to published
      if (operation === 'update' && resolvedData.status === 'published') {
        resolvedData.publishedAt = new Date()
      }

      return resolvedData
    },
    afterOperation: async ({ operation, item }) => {
      // Send notification after publish
      if (operation === 'update' && item?.status === 'published') {
        console.log(\`Post published: \${item.title}\`)
        // await sendNotification(item)
      }
    },
  },
})`,
        notes: 'resolveInput transforms data before save. afterOperation runs side effects. Use beforeOperation for validation.',
        sourcePath: 'packages/core/CLAUDE.md',
      },

      'custom-fields': {
        description: 'Creating custom field types',
        code: `// In your field definition file
import type { BaseFieldConfig } from '@opensaas/stack-core'
import { z } from 'zod'

export type SlugField = BaseFieldConfig & {
  type: 'slug'
  sourceField?: string
}

export function slug(options?: Omit<SlugField, 'type'>): SlugField {
  return {
    type: 'slug',
    ...options,

    getZodSchema: (fieldName, operation) => {
      if (operation === 'create') {
        return z.string().regex(/^[a-z0-9-]+$/).optional()
      }
      return z.string().regex(/^[a-z0-9-]+$/).optional()
    },

    getPrismaType: (fieldName) => ({
      type: 'String',
      modifiers: '?',
      attributes: ['@unique'],
    }),

    getTypeScriptType: () => ({
      type: 'string',
      optional: true,
    }),
  }
}

// Usage in config
fields: {
  title: text({ validation: { isRequired: true } }),
  urlSlug: slug({ sourceField: 'title' }),
}`,
        notes: 'Custom fields implement getZodSchema, getPrismaType, and getTypeScriptType methods. See packages/tiptap for a full example.',
        sourcePath: 'examples/custom-field',
      },
    }

    const normalizedFeature = feature.toLowerCase().replace(/\s+/g, '-')
    return examples[normalizedFeature] || null
  }

  /**
   * Get migration-specific documentation for a project type
   */
  async findMigrationGuide(projectType: string): Promise<string> {
    const guides: Record<string, string> = {
      prisma: `# Prisma to OpenSaaS Migration

## Type Mapping

| Prisma Type | OpenSaaS Field |
|-------------|----------------|
| String | text() |
| Int | integer() |
| Boolean | checkbox() |
| DateTime | timestamp() |
| Json | text() with custom handling |
| Enum | select() |
| @relation | relationship() |

## Key Changes

1. **Models → Lists**: Prisma models become OpenSaaS lists
2. **Access Control**: Add operation-level and field-level access
3. **Database URL**: Now provided via prismaClientConstructor
4. **Relationships**: Use \`ref: 'ListName.fieldName'\` format

## Common Patterns

### Before (Prisma)
\`\`\`prisma
model Post {
  id        String   @id @default(cuid())
  title     String
  author    User     @relation(fields: [authorId], references: [id])
  authorId  String
}
\`\`\`

### After (OpenSaaS)
\`\`\`typescript
Post: list({
  fields: {
    title: text({ validation: { isRequired: true } }),
    author: relationship({ ref: 'User.posts' }),
  },
  access: {
    operation: {
      query: () => true,
      create: ({ session }) => !!session,
    },
  },
})
\`\`\`
`,

      keystone: `# KeystoneJS to OpenSaaS Migration

## Good News!

KeystoneJS and OpenSaaS Stack are very similar. Migration is mostly:
1. Update import paths
2. Minor syntax adjustments
3. Add prismaClientConstructor for Prisma 7

## Key Changes

### Imports
\`\`\`typescript
// Before (KeystoneJS)
import { config, list } from '@keystone-6/core'
import { text, relationship } from '@keystone-6/core/fields'

// After (OpenSaaS)
import { config, list } from '@opensaas/stack-core'
import { text, relationship } from '@opensaas/stack-core/fields'
\`\`\`

### Database Config
\`\`\`typescript
// Before
db: {
  provider: 'sqlite',
  url: 'file:./dev.db',
}

// After (Prisma 7 requires adapters)
db: {
  provider: 'sqlite',
  url: 'file:./dev.db',
  prismaClientConstructor: (PrismaClient) => {
    const db = new Database('./dev.db')
    const adapter = new PrismaBetterSQLite3(db)
    return new PrismaClient({ adapter })
  },
}
\`\`\`

## Field Types (1:1 mapping)

Most field types work identically:
- text() → text()
- integer() → integer()
- checkbox() → checkbox()
- timestamp() → timestamp()
- select() → select()
- relationship() → relationship()

## Access Control (same patterns)

Access control functions work the same way. Just copy them over!
`,

      nextjs: `# Next.js to OpenSaaS Migration

## Overview

If you have a Next.js project without Prisma, you'll need to:
1. Define your data models in opensaas.config.ts
2. Run the generator to create Prisma schema
3. Set up your database

## Steps

1. **Install Dependencies**
\`\`\`bash
pnpm add @opensaas/stack-core @prisma/client prisma
pnpm add -D @prisma/adapter-better-sqlite3 better-sqlite3
\`\`\`

2. **Create opensaas.config.ts**
\`\`\`typescript
import { config, list } from '@opensaas/stack-core'
import { text, integer } from '@opensaas/stack-core/fields'

export default config({
  db: {
    provider: 'sqlite',
    url: 'file:./dev.db',
    prismaClientConstructor: (PrismaClient) => {
      // See examples for adapter setup
    },
  },
  lists: {
    // Define your models here
  },
})
\`\`\`

3. **Generate and Push**
\`\`\`bash
pnpm opensaas generate
npx prisma generate
npx prisma db push
\`\`\`

## If You're Using an Auth Library

- **next-auth**: Consider migrating to Better-auth via @opensaas/stack-auth
- **clerk**: Can continue using Clerk alongside OpenSaaS
- **better-auth**: Use @opensaas/stack-auth plugin
`,
    }

    return guides[projectType.toLowerCase()] || guides.prisma
  }
}
```

---

## Dependencies

The introspectors are imported from Phase 4. For now, create stub files:

**`packages/cli/src/migration/introspectors/prisma-introspector.ts`** (stub)

```typescript
import type { IntrospectedSchema } from '../types.js'

export class PrismaIntrospector {
  async introspect(cwd: string, schemaPath: string): Promise<IntrospectedSchema> {
    // Stub - will be implemented in Phase 4
    throw new Error('PrismaIntrospector not yet implemented')
  }
}
```

**`packages/cli/src/migration/introspectors/keystone-introspector.ts`** (stub)

```typescript
export class KeystoneIntrospector {
  async introspect(cwd: string, configPath: string): Promise<any> {
    // Stub - will be implemented in Phase 4
    throw new Error('KeystoneIntrospector not yet implemented')
  }
}
```

The `MigrationWizard` is from Phase 3, also create a stub:

**`packages/cli/src/mcp/lib/wizards/migration-wizard.ts`** (stub)

```typescript
import type { ProjectType } from '../../../migration/types.js'

export class MigrationWizard {
  async startMigration(projectType: ProjectType) {
    // Stub - will be implemented in Phase 3
    return {
      content: [{ type: 'text' as const, text: 'Migration wizard not yet implemented' }],
    }
  }

  async answerQuestion(sessionId: string, answer: any) {
    // Stub - will be implemented in Phase 3
    return {
      content: [{ type: 'text' as const, text: 'Migration wizard not yet implemented' }],
    }
  }
}
```

---

## Acceptance Criteria

1. **New Tools Registered**
   - [ ] All 6 new tools appear in `opensaas mcp` tool list
   - [ ] Tool schemas are valid JSON Schema
   - [ ] Tool descriptions are clear

2. **Documentation Provider**
   - [ ] `searchLocalDocs` finds content in CLAUDE.md files
   - [ ] `getExampleConfig` returns code for known features
   - [ ] `findMigrationGuide` returns guides for all project types
   - [ ] Results are properly formatted markdown

3. **Tool Handlers**
   - [ ] Each tool returns proper MCP response format
   - [ ] Error handling returns isError: true with message
   - [ ] Tools work without session context

4. **Integration**
   - [ ] Stubs exist for Phase 3 & 4 dependencies
   - [ ] Server starts without errors
   - [ ] Existing tools still work

---

## Testing

```bash
# Build the CLI
cd packages/cli
pnpm build

# Start MCP server directly
node dist/mcp/server/index.js

# Test tools using MCP inspector or Claude Code
```

Test each tool with vitest tests:
1. `opensaas_introspect_prisma` - On a project with prisma/schema.prisma
2. `opensaas_search_migration_docs` - Search for "access control"
3. `opensaas_get_example` - Get "blog-with-auth" example
