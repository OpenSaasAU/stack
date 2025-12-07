/**
 * OpenSaaS Stack MCP Server - Business logic for MCP tools
 */

import { WizardEngine } from '../lib/wizards/wizard-engine.js'
import { MigrationWizard } from '../lib/wizards/migration-wizard.js'
import { OpenSaasDocumentationProvider } from '../lib/documentation-provider.js'
import { getAllFeatures, getFeature } from '../lib/features/catalog.js'
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

  /**
   * Implement a feature - starts the wizard flow
   */
  async implementFeature({ feature, description }: { feature: string; description?: string }) {
    if (feature === 'custom' && !description) {
      return {
        content: [
          {
            type: 'text' as const,
            text: '❌ For custom features, please provide a description of what you want to build.',
          },
        ],
      }
    }

    if (feature === 'custom') {
      return {
        content: [
          {
            type: 'text' as const,
            text: `🔧 **Custom Feature**: ${description}

I'll help you build this custom feature. Let me search the docs for relevant patterns...

${await this.searchFeatureDocs({ topic: description! })}

Based on your description, consider using these OpenSaaS patterns:
- Define your data model with \`list()\` and field types
- Add access control with \`access.operation\` and \`access.field\`
- Use hooks for data transformation and side effects
- Consider if any plugins would help (auth, storage, RAG)

Would you like me to help you design the config for this feature?`,
          },
        ],
      }
    }

    return this.wizardEngine.startFeature(feature)
  }

  /**
   * Answer a wizard question
   */
  async answerFeatureQuestion({
    sessionId,
    answer,
  }: {
    sessionId: string
    answer: string | boolean | string[]
  }) {
    return this.wizardEngine.answerQuestion(sessionId, answer)
  }

  /**
   * Answer a follow-up question
   */
  async answerFollowUpQuestion({ sessionId, answer }: { sessionId: string; answer: string }) {
    return this.wizardEngine.answerFollowUp(sessionId, answer)
  }

  /**
   * Search documentation
   */
  async searchFeatureDocs({ topic }: { topic: string }) {
    const docs = await this.docsProvider.getTopicDocs(topic)

    return {
      content: [
        {
          type: 'text' as const,
          text: `# ${docs.topic}

${docs.content}

${docs.codeExamples.length > 0 ? `\n## Code Examples\n\n${docs.codeExamples.join('\n\n')}` : ''}

${docs.relatedTopics.length > 0 ? `\n## Related Topics\n\n${docs.relatedTopics.map((t) => `- ${t}`).join('\n')}` : ''}

---

📚 **Full documentation**: ${docs.url}`,
        },
      ],
    }
  }

  /**
   * List all available features
   */
  async listFeatures() {
    const features = getAllFeatures()
    const categories = {
      authentication: [] as typeof features,
      content: [] as typeof features,
      storage: [] as typeof features,
      search: [] as typeof features,
      custom: [] as typeof features,
    }

    features.forEach((feature) => {
      categories[feature.category].push(feature)
    })

    const formatFeatureList = (featureList: typeof features) =>
      featureList
        .map(
          (f) =>
            `### ${f.name}\n**ID**: \`${f.id}\`\n${f.description}\n\n**Includes**:\n${f.includes.map((i) => `- ${i}`).join('\n')}\n${f.dependsOn && f.dependsOn.length > 0 ? `\n**Requires**: ${f.dependsOn.join(', ')}` : ''}`,
        )
        .join('\n\n')

    return {
      content: [
        {
          type: 'text' as const,
          text: `# Available OpenSaaS Stack Features

Use \`opensaas_implement_feature\` to start implementing any of these:

## 🔐 Authentication

${formatFeatureList(categories.authentication)}

## 📝 Content Management

${formatFeatureList(categories.content)}

## 📦 Storage

${formatFeatureList(categories.storage)}

## 🔍 Search

${formatFeatureList(categories.search)}

---

**To implement a feature**, call:
\`\`\`
opensaas_implement_feature({ feature: "authentication" })
\`\`\`

**For custom features**, call:
\`\`\`
opensaas_implement_feature({
  feature: "custom",
  description: "what you want to build"
})
\`\`\``,
        },
      ],
    }
  }

  /**
   * Suggest complementary features based on described features
   */
  async suggestFeatures({ currentFeatures }: { currentFeatures?: string[] }) {
    const allFeatures = getAllFeatures()
    const implemented = new Set(currentFeatures || [])

    const suggestions = allFeatures
      .filter((f) => !implemented.has(f.id))
      .map((f) => {
        let reasoning = ''

        // Add context-aware suggestions
        if (f.id === 'authentication' && !implemented.has('authentication')) {
          reasoning = 'Essential for user management and access control'
        } else if (f.id === 'blog' && implemented.has('authentication')) {
          reasoning = 'You have auth - add content creation capabilities'
        } else if (
          f.id === 'comments' &&
          (implemented.has('blog') || implemented.has('authentication'))
        ) {
          reasoning = 'Enhance engagement with user comments'
        } else if (
          f.id === 'file-upload' &&
          (implemented.has('blog') || implemented.has('authentication'))
        ) {
          reasoning = 'Add media support for richer content'
        } else if (f.id === 'semantic-search' && implemented.has('blog')) {
          reasoning = 'Make your content more discoverable'
        }

        return { feature: f, reasoning }
      })
      .filter((s) => s.reasoning)

    if (suggestions.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: "🎉 You've implemented all our built-in features!\n\nConsider building custom features tailored to your specific needs using `opensaas_implement_feature({ feature: 'custom', description: '...' })`",
          },
        ],
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `# Feature Suggestions

Based on ${currentFeatures && currentFeatures.length > 0 ? `your current features (${currentFeatures.join(', ')})` : 'common patterns'}, consider adding:

${suggestions
  .map(
    (s, i) => `## ${i + 1}. ${s.feature.name}

${s.reasoning}

**What you'll get**:
${s.feature.includes.map((inc) => `- ${inc}`).join('\n')}

**To implement**: \`opensaas_implement_feature({ feature: "${s.feature.id}" })\`
`,
  )
  .join('\n---\n\n')}`,
        },
      ],
    }
  }

  /**
   * Validate a feature implementation
   */
  async validateFeature({ feature }: { feature: string; configPath?: string }) {
    const featureDefinition = getFeature(feature)

    if (!featureDefinition) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `❌ Unknown feature: ${feature}\n\nUse \`opensaas_list_features\` to see available features.`,
          },
        ],
      }
    }

    // TODO: Implement actual validation by reading the config file
    // For now, return validation checklist

    return {
      content: [
        {
          type: 'text' as const,
          text: `# ${featureDefinition.name} Validation

Checking your implementation...

## Checklist

${featureDefinition.includes.map((item) => `- [ ] ${item}`).join('\n')}

${featureDefinition.dependsOn && featureDefinition.dependsOn.length > 0 ? `\n## Dependencies\n\nEnsure these features are implemented:\n${featureDefinition.dependsOn.map((dep) => `- [ ] ${dep}`).join('\n')}\n` : ''}

---

**Manual validation steps**:

1. Check that all required lists are defined in your config
2. Verify access control is properly configured
3. Test the feature in your development environment
4. Run \`pnpm generate\` and \`pnpm db:push\` successfully

**Note**: Full automatic validation coming soon! For now, use this checklist to verify your implementation.`,
        },
      ],
    }
  }

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
        .map((m) => {
          const fields = m.fields
            .map((f) => {
              let type = f.type
              if (f.relation) type = `→ ${f.relation.model}`
              if (f.isList) type = `${type}[]`
              if (!f.isRequired) type = `${type}?`
              return `    - ${f.name}: ${type}`
            })
            .join('\n')
          return `### ${m.name}\n${fields}`
        })
        .join('\n\n')

      const enumList =
        schema.enums.length > 0
          ? `\n## Enums\n\n${schema.enums.map((e) => `- **${e.name}**: ${e.values.join(', ')}`).join('\n')}`
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

      const listInfo = config.models
        .map((m) => {
          const fields = m.fields.map((f) => `    - ${f.name}: ${f.type}`).join('\n')
          return `### ${m.name}\n${fields}`
        })
        .join('\n\n')

      return {
        content: [
          {
            type: 'text' as const,
            text: `# KeystoneJS Config Analysis

**Lists:** ${config.models.length}

## Lists

${listInfo}

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

  /**
   * Cleanup - clear wizard sessions and caches
   */
  cleanup() {
    this.wizardEngine.clearCompletedSessions()
    this.docsProvider.clearExpiredCache()
  }
}
