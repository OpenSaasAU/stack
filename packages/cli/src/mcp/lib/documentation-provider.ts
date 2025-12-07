/**
 * Documentation provider - Fetches documentation from the hosted docs site
 */

import fs from 'fs-extra'
import path from 'path'
import { glob } from 'glob'
import type { DocumentationLookup } from './types.js'

interface SearchResult {
  content: string
  metadata: {
    title?: string
    slug?: string
    section?: string
  }
  score: number
}

interface SearchResponse {
  results: SearchResult[]
  query: string
  count: number
}

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
  private readonly DOCS_API = 'https://stack.opensaas.au/api/search'
  private cache = new Map<string, { data: DocumentationLookup; timestamp: number }>()
  private readonly CACHE_TTL = 1000 * 60 * 30 // 30 minutes

  // Topic mappings for user-friendly queries
  private topicMappings: Record<string, string> = {
    fields: 'field-types',
    'field types': 'field-types',
    'field type': 'field-types',
    access: 'access-control',
    'access control': 'access-control',
    permissions: 'access-control',
    auth: 'authentication',
    authentication: 'authentication',
    login: 'authentication',
    'sign in': 'authentication',
    hooks: 'hooks',
    hook: 'hooks',
    lifecycle: 'hooks',
    plugins: 'plugin-system',
    plugin: 'plugin-system',
    rag: 'rag',
    search: 'semantic-search',
    'semantic search': 'semantic-search',
    storage: 'file-storage',
    files: 'file-storage',
    upload: 'file-storage',
    config: 'configuration',
    configuration: 'configuration',
    prisma: 'prisma-integration',
    database: 'database-setup',
    deployment: 'deployment',
    deploy: 'deployment',
  }

  /**
   * Search documentation by query
   */
  async searchDocs(query: string, limit = 5, minScore = 0.7): Promise<DocumentationLookup> {
    const cacheKey = `search:${query}:${limit}:${minScore}`

    // Check cache
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data
    }

    try {
      const response = await fetch(this.DOCS_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, limit, minScore }),
      })

      if (!response.ok) {
        throw new Error(`Docs API error: ${response.statusText}`)
      }

      const data = (await response.json()) as SearchResponse

      const docLookup: DocumentationLookup = {
        topic: query,
        content: this.formatSearchResults(data.results),
        url: 'https://stack.opensaas.au/',
        codeExamples: this.extractCodeExamples(data.results),
        relatedTopics: this.extractRelatedTopics(data.results),
      }

      // Cache the result
      this.cache.set(cacheKey, { data: docLookup, timestamp: Date.now() })

      return docLookup
    } catch (error) {
      console.error('Error fetching documentation:', error)
      return this.getFallbackDocs(query)
    }
  }

  /**
   * Get documentation for a specific topic
   */
  async getTopicDocs(topic: string): Promise<DocumentationLookup> {
    // Normalize topic using mappings
    const normalizedTopic = this.topicMappings[topic.toLowerCase()] || topic

    return this.searchDocs(normalizedTopic, 3, 0.8)
  }

  /**
   * Format search results into readable content
   */
  private formatSearchResults(results: SearchResult[]): string {
    if (results.length === 0) {
      return 'No documentation found for this query.'
    }

    return results
      .map((result, index) => {
        const title = result.metadata.title || `Section ${index + 1}`
        const section = result.metadata.section || ''
        const score = (result.score * 100).toFixed(0)

        return `### ${title}${section ? ` (${section})` : ''} [Relevance: ${score}%]\n\n${result.content}\n`
      })
      .join('\n---\n\n')
  }

  /**
   * Extract code examples from search results
   */
  private extractCodeExamples(results: SearchResult[]): string[] {
    const codeExamples: string[] = []
    const codeBlockRegex = /```[\s\S]*?```/g

    for (const result of results) {
      const matches = result.content.match(codeBlockRegex)
      if (matches) {
        codeExamples.push(...matches)
      }
    }

    return codeExamples
  }

  /**
   * Extract related topics from search results
   */
  private extractRelatedTopics(results: SearchResult[]): string[] {
    const topics = new Set<string>()

    for (const result of results) {
      if (result.metadata.section) {
        topics.add(result.metadata.section)
      }
    }

    return Array.from(topics)
  }

  /**
   * Fallback documentation when API is unavailable
   */
  private getFallbackDocs(query: string): DocumentationLookup {
    return {
      topic: query,
      content: `Unable to fetch documentation from the docs site at this time.

Please visit the OpenSaaS Stack documentation directly:
https://stack.opensaas.au/

For ${query}, you can also check:
- GitHub repository: https://github.com/OpenSaasAU/stack
- Example projects in the examples/ directory`,
      url: 'https://stack.opensaas.au/',
      codeExamples: [],
      relatedTopics: [],
    }
  }

  /**
   * Search local CLAUDE.md files in the monorepo
   */
  async searchLocalDocs(query: string): Promise<LocalDocResult> {
    const cwd = process.cwd()

    // Find CLAUDE.md files
    const claudeFiles = await glob('**/CLAUDE.md', {
      cwd,
      ignore: ['node_modules/**', '.next/**', 'dist/**', 'build/**'],
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

          for (const line of lines) {
            const lineLower = line.toLowerCase()

            // Check if line starts a section
            if (line.startsWith('#')) {
              // Check if this section title is relevant
              const titleRelevant = queryTerms.some((term) => lineLower.includes(term))
              if (titleRelevant) {
                inRelevantSection = true
                relevantLines.push(line)
              } else if (inRelevantSection) {
                // We've left the relevant section
                break
              }
            } else if (inRelevantSection) {
              relevantLines.push(line)
            } else if (queryTerms.some((term) => lineLower.includes(term))) {
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
      .map((r) => `### From \`${r.file}\`\n\n${r.content}`)
      .join('\n\n---\n\n')

    return {
      content,
      files: results.map((r) => r.file),
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
        notes:
          'This example uses the auth plugin for user management. The `isAuthor` helper restricts updates to the post creator.',
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
        notes:
          'Access control functions receive session and item context. Use filter access to automatically scope queries.',
        sourcePath: 'packages/core/CLAUDE.md',
      },

      relationships: {
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
        notes:
          'Relationships use `ref: "ListName.fieldName"` format. Set `many: true` for one-to-many or many-to-many.',
        sourcePath: 'examples/blog/opensaas.config.ts',
      },

      hooks: {
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
        notes:
          'resolveInput transforms data before save. afterOperation runs side effects. Use beforeOperation for validation.',
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
        notes:
          'Custom fields implement getZodSchema, getPrismaType, and getTypeScriptType methods. See packages/tiptap for a full example.',
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

  /**
   * Clear expired cache entries
   */
  clearExpiredCache(): void {
    const now = Date.now()
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp >= this.CACHE_TTL) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    this.cache.clear()
  }
}
