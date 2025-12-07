# Phase 3: Migration Wizard Engine

## Task Overview

Create an interactive migration wizard that guides users through converting their existing project to OpenSaaS Stack. The wizard collects information through a series of questions and generates the final configuration.

## Context

### Existing Wizard Pattern

The codebase has an existing wizard engine at `packages/cli/src/mcp/lib/wizards/wizard-engine.ts`:

```typescript
import type { Feature, WizardSession, SessionStorage, FeatureQuestion } from '../types.js'
import { getFeature } from '../features/catalog.js'
import { FeatureGenerator } from '../generators/feature-generator.js'

export class WizardEngine {
  private sessions: SessionStorage = {}

  async startFeature(featureId: string): Promise<{
    content: Array<{ type: string; text: string }>
  }> {
    const feature = getFeature(featureId)
    if (!feature) {
      return { content: [{ type: 'text', text: `❌ Unknown feature: "${featureId}"` }] }
    }

    const sessionId = this.generateSessionId()
    const session = this.createSession(sessionId, feature)
    this.sessions[sessionId] = session

    const progressBar = this.renderProgressBar(1, feature.questions.length)
    const firstQuestion = this.renderQuestion(feature.questions[0], session, 1)

    return {
      content: [{
        type: 'text',
        text: `🚀 **${feature.name} Implementation**

${feature.description}

---

## Let's configure this feature

${firstQuestion}

---

**Progress**: ${progressBar} 1/${feature.questions.length}
**Session ID**: \`${sessionId}\``,
      }],
    }
  }

  async answerQuestion(sessionId: string, answer: string | boolean | string[]): Promise<{
    content: Array<{ type: string; text: string }>
  }> {
    const session = this.sessions[sessionId]
    if (!session) {
      return { content: [{ type: 'text', text: `❌ Session not found: ${sessionId}` }] }
    }

    // Validate, store answer, move to next question or complete
    // ... (see full file for implementation)
  }

  // Helper methods
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }

  private renderProgressBar(current: number, total: number): string {
    const filled = Math.round((current / total) * 10)
    const empty = 10 - filled
    return '▓'.repeat(filled) + '░'.repeat(empty)
  }
}
```

### Session & Question Types

From `packages/cli/src/mcp/lib/types.ts`:

```typescript
export type QuestionType = 'text' | 'textarea' | 'select' | 'multiselect' | 'boolean'

export interface FeatureQuestion {
  id: string
  text: string
  type: QuestionType
  required?: boolean
  options?: string[]
  defaultValue?: string | boolean | string[]
  dependsOn?: { questionId: string; value: string | boolean }
  followUp?: { if: string | boolean; ask: string; type: QuestionType; options?: string[] }
}

export interface WizardSession {
  id: string
  featureId: string
  feature: Feature
  currentQuestionIndex: number
  answers: Record<string, string | boolean | string[]>
  followUpAnswers: Record<string, string | boolean | string[]>
  isComplete: boolean
  createdAt: Date
  updatedAt: Date
}
```

---

## Requirements

### 1. Create Migration Wizard

**File to create:** `packages/cli/src/mcp/lib/wizards/migration-wizard.ts`

The wizard should:

1. **Start with project analysis** - Use introspected schema data
2. **Generate dynamic questions** - Based on detected models
3. **Collect answers step-by-step** - Store in session
4. **Generate final config** - Call MigrationGenerator when complete
5. **Provide Claude Code instructions** - Guide AI through the flow

### 2. Question Categories

The wizard asks about:

1. **Database** - Provider, adapter choice
2. **Authentication** - Enable auth plugin, methods
3. **Per-Model Access Control** - For each detected model
4. **Admin UI** - Base path, customizations
5. **Plugins** - Additional features to enable

### 3. Session Management

- Sessions persist for the MCP server lifetime
- Cleanup completed sessions periodically
- Handle invalid session IDs gracefully

---

## File Template

### `packages/cli/src/mcp/lib/wizards/migration-wizard.ts`

```typescript
/**
 * Migration Wizard - Interactive guide for migrating to OpenSaaS Stack
 */

import type { ProjectType, MigrationSession, IntrospectedSchema, IntrospectedModel } from '../../../migration/types.js'
import { MigrationGenerator } from '../../../migration/generators/migration-generator.js'

interface MigrationQuestion {
  id: string
  text: string
  type: 'text' | 'select' | 'boolean' | 'multiselect'
  options?: string[]
  defaultValue?: string | boolean | string[]
  required?: boolean
  context?: string // Additional context shown with the question
}

interface MigrationSessionStorage {
  [sessionId: string]: MigrationSession
}

export class MigrationWizard {
  private sessions: MigrationSessionStorage = {}
  private generator: MigrationGenerator

  constructor() {
    this.generator = new MigrationGenerator()
  }

  /**
   * Start a new migration wizard session
   */
  async startMigration(
    projectType: ProjectType,
    analysis?: IntrospectedSchema
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    const sessionId = this.generateSessionId()

    // Generate questions based on project type and analysis
    const questions = this.generateQuestions(projectType, analysis)

    const session: MigrationSession = {
      id: sessionId,
      projectType,
      analysis: {
        projectTypes: [projectType],
        cwd: process.cwd(),
        models: analysis?.models?.map(m => ({
          name: m.name,
          fieldCount: m.fields.length,
        })),
        provider: analysis?.provider,
      },
      currentQuestionIndex: 0,
      answers: {},
      isComplete: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    // Store questions in session for later reference
    ;(session as any).questions = questions

    this.sessions[sessionId] = session

    const totalQuestions = questions.length
    const firstQuestion = questions[0]
    const progressBar = this.renderProgressBar(1, totalQuestions)

    return {
      content: [
        {
          type: 'text' as const,
          text: `# 🚀 OpenSaaS Stack Migration Wizard

## Project Analysis

- **Project Type:** ${projectType}
- **Models:** ${analysis?.models?.length || 0}
- **Database:** ${analysis?.provider || 'Not detected'}

---

## Let's Configure Your Migration

${this.renderQuestion(firstQuestion, 1, totalQuestions)}

---

**Progress:** ${progressBar} 1/${totalQuestions}

<details>
<summary>💡 **Instructions for Claude**</summary>

1. Present this question naturally to the user
2. When they answer, call \`opensaas_answer_migration\` with:
   - \`sessionId\`: "${sessionId}"
   - \`answer\`: their response (string, boolean, or array)
3. Continue until the wizard is complete
4. Do NOT mention session IDs to the user

</details>`,
        },
      ],
    }
  }

  /**
   * Answer a wizard question
   */
  async answerQuestion(
    sessionId: string,
    answer: string | boolean | string[]
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    const session = this.sessions[sessionId]
    if (!session) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `❌ **Session not found:** ${sessionId}

Please start a new migration with \`opensaas_start_migration\`.`,
          },
        ],
      }
    }

    const questions = (session as any).questions as MigrationQuestion[]
    const currentQuestion = questions[session.currentQuestionIndex]

    // Validate answer
    const validation = this.validateAnswer(answer, currentQuestion)
    if (!validation.valid) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `❌ **Invalid answer:** ${validation.message}

${this.renderQuestion(currentQuestion, session.currentQuestionIndex + 1, questions.length)}`,
          },
        ],
      }
    }

    // Store answer
    session.answers[currentQuestion.id] = answer
    session.updatedAt = new Date()

    // Move to next question
    session.currentQuestionIndex++

    // Check if complete
    if (session.currentQuestionIndex >= questions.length) {
      session.isComplete = true
      return this.generateMigrationConfig(session)
    }

    // Render next question
    const nextQuestion = questions[session.currentQuestionIndex]
    const questionNum = session.currentQuestionIndex + 1
    const progressBar = this.renderProgressBar(questionNum, questions.length)

    return {
      content: [
        {
          type: 'text' as const,
          text: `✅ **Recorded:** ${this.formatAnswer(answer)}

---

${this.renderQuestion(nextQuestion, questionNum, questions.length)}

---

**Progress:** ${progressBar} ${questionNum}/${questions.length}`,
        },
      ],
    }
  }

  /**
   * Generate questions based on project type and analysis
   */
  private generateQuestions(
    projectType: ProjectType,
    analysis?: IntrospectedSchema
  ): MigrationQuestion[] {
    const questions: MigrationQuestion[] = []

    // 1. Database configuration
    questions.push({
      id: 'preserve_database',
      text: 'Do you want to keep your existing database?',
      type: 'boolean',
      defaultValue: true,
      context: 'If yes, we\'ll generate a config that matches your current schema.',
    })

    questions.push({
      id: 'db_provider',
      text: 'Which database provider are you using?',
      type: 'select',
      options: ['sqlite', 'postgresql', 'mysql'],
      defaultValue: analysis?.provider || 'sqlite',
    })

    // 2. Authentication
    questions.push({
      id: 'enable_auth',
      text: 'Do you want to add authentication?',
      type: 'boolean',
      defaultValue: this.hasAuthModels(analysis),
      context: 'Uses Better-auth for user management and sessions.',
    })

    questions.push({
      id: 'auth_methods',
      text: 'Which authentication methods do you want?',
      type: 'multiselect',
      options: ['email-password', 'google', 'github', 'magic-link'],
      defaultValue: ['email-password'],
    })

    // 3. Access control strategy
    questions.push({
      id: 'default_access',
      text: 'What should be the default access control strategy?',
      type: 'select',
      options: [
        'public-read-auth-write',
        'authenticated-only',
        'owner-only',
        'admin-only',
      ],
      defaultValue: 'public-read-auth-write',
      context: `
- **public-read-auth-write**: Anyone can read, only logged-in users can write
- **authenticated-only**: Only logged-in users can read or write
- **owner-only**: Users can only access their own data
- **admin-only**: Only admins can access`,
    })

    // 4. Per-model configuration (if models detected)
    if (analysis?.models && analysis.models.length > 0) {
      // Ask about special models
      const modelNames = analysis.models.map(m => m.name)

      if (modelNames.some(n => ['User', 'Account', 'Session'].includes(n))) {
        questions.push({
          id: 'skip_auth_models',
          text: 'We detected User/Account/Session models. Should we skip these (they\'ll be managed by the auth plugin)?',
          type: 'boolean',
          defaultValue: true,
          context: 'The auth plugin automatically creates these models.',
        })
      }

      // Ask about models that need special access control
      const nonAuthModels = modelNames.filter(
        n => !['User', 'Account', 'Session', 'Verification'].includes(n)
      )

      if (nonAuthModels.length > 0) {
        questions.push({
          id: 'models_with_owner',
          text: `Which models should have owner-based access control? (User can only access their own)`,
          type: 'multiselect',
          options: nonAuthModels,
          defaultValue: this.guessOwnerModels(analysis.models, nonAuthModels),
          context: 'Models with a relationship to User are good candidates.',
        })
      }
    }

    // 5. Admin UI
    questions.push({
      id: 'admin_base_path',
      text: 'What base path should the admin UI use?',
      type: 'text',
      defaultValue: '/admin',
    })

    // 6. Additional features
    questions.push({
      id: 'additional_features',
      text: 'Do you want to add any additional features?',
      type: 'multiselect',
      options: ['file-storage', 'semantic-search', 'audit-logging'],
      defaultValue: [],
      context: 'These can be added later. Select any you want included now.',
    })

    // 7. Final confirmation
    questions.push({
      id: 'confirm',
      text: 'Ready to generate your opensaas.config.ts?',
      type: 'boolean',
      defaultValue: true,
      context: 'You can always modify the generated config afterwards.',
    })

    return questions
  }

  /**
   * Generate the final migration config
   */
  private async generateMigrationConfig(
    session: MigrationSession
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    try {
      const output = await this.generator.generate(session)

      // Clean up session
      delete this.sessions[session.id]

      return {
        content: [
          {
            type: 'text' as const,
            text: `# ✅ Migration Complete!

## Generated opensaas.config.ts

\`\`\`typescript
${output.configContent}
\`\`\`

---

## Install Dependencies

\`\`\`bash
${output.dependencies.map(d => `pnpm add ${d}`).join('\n')}
\`\`\`

---

${output.files.length > 0 ? `## Additional Files

${output.files.map(f => `### ${f.path}

*${f.description}*

\`\`\`${f.language}
${f.content}
\`\`\``).join('\n\n')}

---

` : ''}

${output.warnings.length > 0 ? `## ⚠️ Warnings

${output.warnings.map(w => `- ${w}`).join('\n')}

---

` : ''}

## Next Steps

${output.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}

---

🎉 **Your migration is ready!**

The generated config creates an OpenSaaS Stack application that matches your existing schema.

📚 **Documentation:** https://stack.opensaas.au/`,
          },
        ],
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        content: [
          {
            type: 'text' as const,
            text: `❌ **Failed to generate config:** ${message}

Please try again or create the config manually.

📚 See: https://stack.opensaas.au/guides/migration`,
          },
        ],
      }
    }
  }

  /**
   * Check if analysis includes auth-related models
   */
  private hasAuthModels(analysis?: IntrospectedSchema): boolean {
    if (!analysis?.models) return false
    const authModelNames = ['User', 'Account', 'Session']
    return analysis.models.some(m => authModelNames.includes(m.name))
  }

  /**
   * Guess which models should have owner-based access
   */
  private guessOwnerModels(
    models: IntrospectedModel[],
    modelNames: string[]
  ): string[] {
    const ownerModels: string[] = []

    for (const name of modelNames) {
      const model = models.find(m => m.name === name)
      if (!model) continue

      // Check if model has a relationship to User
      const hasUserRelation = model.fields.some(
        f => f.relation && (f.relation.model === 'User' || f.name.toLowerCase().includes('author') || f.name.toLowerCase().includes('owner'))
      )

      if (hasUserRelation) {
        ownerModels.push(name)
      }
    }

    return ownerModels
  }

  /**
   * Render a question for display
   */
  private renderQuestion(
    question: MigrationQuestion,
    questionNum: number,
    totalQuestions: number
  ): string {
    let rendered = `### Question ${questionNum}/${totalQuestions}\n\n**${question.text}**\n\n`

    if (question.context) {
      rendered += `${question.context}\n\n`
    }

    if (question.type === 'select') {
      rendered += question.options!.map(opt => `- \`${opt}\``).join('\n')
    } else if (question.type === 'multiselect') {
      rendered += question.options!.map(opt => `- \`${opt}\``).join('\n')
      rendered += '\n\n*Select multiple (comma-separated) or empty for none*'
    } else if (question.type === 'boolean') {
      rendered += '*Answer: yes or no*'
    } else if (question.type === 'text') {
      rendered += '*Enter your response*'
    }

    if (question.defaultValue !== undefined) {
      rendered += `\n\n*Default: ${this.formatAnswer(question.defaultValue)}*`
    }

    return rendered
  }

  /**
   * Validate an answer
   */
  private validateAnswer(
    answer: string | boolean | string[],
    question: MigrationQuestion
  ): { valid: boolean; message?: string } {
    if (question.required && !answer) {
      return { valid: false, message: 'This question requires an answer.' }
    }

    if (question.type === 'boolean') {
      const normalized = this.normalizeBoolean(answer)
      if (normalized === null) {
        return { valid: false, message: 'Please answer with yes/no or true/false.' }
      }
    }

    if (question.type === 'select' && question.options) {
      if (!question.options.includes(answer as string)) {
        return {
          valid: false,
          message: `Please select one of: ${question.options.join(', ')}`,
        }
      }
    }

    if (question.type === 'multiselect' && question.options) {
      const answers = Array.isArray(answer) ? answer : (answer as string).split(',').map(a => a.trim()).filter(Boolean)
      const invalid = answers.filter(a => !question.options!.includes(a))
      if (invalid.length > 0) {
        return {
          valid: false,
          message: `Invalid options: ${invalid.join(', ')}. Valid: ${question.options.join(', ')}`,
        }
      }
    }

    return { valid: true }
  }

  /**
   * Normalize boolean answer
   */
  private normalizeBoolean(answer: string | boolean | string[]): boolean | null {
    if (typeof answer === 'boolean') return answer
    if (typeof answer !== 'string') return null

    const lower = answer.toLowerCase().trim()
    if (['yes', 'y', 'true', '1'].includes(lower)) return true
    if (['no', 'n', 'false', '0'].includes(lower)) return false
    return null
  }

  /**
   * Format an answer for display
   */
  private formatAnswer(answer: string | boolean | string[]): string {
    if (typeof answer === 'boolean') return answer ? 'Yes' : 'No'
    if (Array.isArray(answer)) return answer.length > 0 ? answer.join(', ') : '(none)'
    return String(answer)
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `migration_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * Render a progress bar
   */
  private renderProgressBar(current: number, total: number): string {
    const filled = Math.round((current / total) * 10)
    const empty = 10 - filled
    return '▓'.repeat(filled) + '░'.repeat(empty)
  }

  /**
   * Get a session by ID (for testing/debugging)
   */
  getSession(sessionId: string): MigrationSession | undefined {
    return this.sessions[sessionId]
  }

  /**
   * Clear completed sessions
   */
  clearCompletedSessions(): void {
    Object.keys(this.sessions).forEach(id => {
      if (this.sessions[id].isComplete) {
        delete this.sessions[id]
      }
    })
  }

  /**
   * Clear old sessions (older than 1 hour)
   */
  clearOldSessions(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000
    Object.keys(this.sessions).forEach(id => {
      if (this.sessions[id].createdAt.getTime() < oneHourAgo) {
        delete this.sessions[id]
      }
    })
  }
}
```

---

## Dependencies

This phase depends on:

1. **Phase 1 Types** - `MigrationSession` from `packages/cli/src/migration/types.ts`
2. **Phase 4 Introspectors** - `IntrospectedSchema`, `IntrospectedModel` types
3. **Phase 5 Generator** - `MigrationGenerator` class

Create a stub for Phase 5:

**`packages/cli/src/migration/generators/migration-generator.ts`** (stub)

```typescript
import type { MigrationSession, MigrationOutput } from '../types.js'

export class MigrationGenerator {
  async generate(session: MigrationSession): Promise<MigrationOutput> {
    // Stub - will be implemented in Phase 5
    return {
      configContent: '// Generated config will appear here',
      dependencies: ['@opensaas/stack-core', '@prisma/client'],
      files: [],
      steps: ['Install dependencies', 'Run opensaas generate', 'Run prisma db push'],
      warnings: [],
    }
  }
}
```

---

## Acceptance Criteria

1. **Wizard Start**
   - [ ] Creates session with unique ID
   - [ ] Generates appropriate questions based on project type
   - [ ] Shows project analysis summary
   - [ ] Displays first question with proper formatting

2. **Question Flow**
   - [ ] Validates answers appropriately (boolean, select, multiselect)
   - [ ] Stores answers in session
   - [ ] Shows progress bar and question number
   - [ ] Handles edge cases (empty answers, invalid options)

3. **Dynamic Questions**
   - [ ] Generates per-model questions for detected models
   - [ ] Skips auth models when auth plugin is used
   - [ ] Guesses owner models based on relationships

4. **Completion**
   - [ ] Calls generator when all questions answered
   - [ ] Shows generated config in markdown
   - [ ] Lists dependencies to install
   - [ ] Shows warnings for unsupported features
   - [ ] Provides clear next steps

5. **Session Management**
   - [ ] Sessions persist across MCP calls
   - [ ] Handles invalid session IDs gracefully
   - [ ] Cleanup methods work correctly

---

## Testing

### Unit Tests

Create test file `packages/cli/tests/migration-wizard.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { MigrationWizard } from '../src/mcp/lib/wizards/migration-wizard'

describe('MigrationWizard', () => {
  let wizard: MigrationWizard

  beforeEach(() => {
    wizard = new MigrationWizard()
  })

  it('should start a migration session', async () => {
    const result = await wizard.startMigration('prisma')
    expect(result.content[0].text).toContain('Migration Wizard')
    expect(result.content[0].text).toContain('Session ID')
  })

  it('should answer questions and progress', async () => {
    const startResult = await wizard.startMigration('prisma')
    const sessionIdMatch = startResult.content[0].text.match(/sessionId.*?:\s*"([^"]+)"/)
    const sessionId = sessionIdMatch?.[1]

    expect(sessionId).toBeDefined()

    const answerResult = await wizard.answerQuestion(sessionId!, true)
    expect(answerResult.content[0].text).toContain('Recorded')
    expect(answerResult.content[0].text).toContain('Question 2')
  })

  it('should handle invalid session ID', async () => {
    const result = await wizard.answerQuestion('invalid-session', true)
    expect(result.content[0].text).toContain('Session not found')
  })

  it('should validate select answers', async () => {
    const startResult = await wizard.startMigration('prisma')
    const sessionIdMatch = startResult.content[0].text.match(/sessionId.*?:\s*"([^"]+)"/)
    const sessionId = sessionIdMatch?.[1]

    // Answer first question (boolean)
    await wizard.answerQuestion(sessionId!, true)

    // Try invalid select answer
    const invalidResult = await wizard.answerQuestion(sessionId!, 'invalid-provider')
    expect(invalidResult.content[0].text).toContain('Invalid')
  })
})
```

### Manual Testing

```bash
# Build and start MCP server
cd packages/cli
pnpm build
node dist/mcp/server/index.js

# In another terminal, use MCP inspector or Claude Code to:
# 1. Call opensaas_start_migration with projectType: "prisma"
# 2. Answer questions using opensaas_answer_migration
# 3. Verify final config is generated
```
