/**
 * OpenSaaS Stack MCP Server - Business logic for MCP tools
 */

import { WizardEngine } from '../lib/wizards/wizard-engine.js'
import { OpenSaasDocumentationProvider } from '../lib/documentation-provider.js'
import { getAllFeatures, getFeature } from '../lib/features/catalog.js'

export class StackMCPServer {
  private wizardEngine: WizardEngine
  private docsProvider: OpenSaasDocumentationProvider

  constructor() {
    this.wizardEngine = new WizardEngine()
    this.docsProvider = new OpenSaasDocumentationProvider()
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
  async validateFeature({ feature, configPath }: { feature: string; configPath?: string }) {
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
   * Cleanup - clear wizard sessions and caches
   */
  cleanup() {
    this.wizardEngine.clearCompletedSessions()
    this.docsProvider.clearExpiredCache()
  }
}
