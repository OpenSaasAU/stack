/**
 * Wizard engine for multi-step feature implementation flows
 */

import type { Feature, WizardSession, SessionStorage, FeatureQuestion } from '../types.js'
import { getFeature } from '../features/catalog.js'
import { FeatureGenerator } from '../generators/feature-generator.js'

export class WizardEngine {
  private sessions: SessionStorage = {}

  /**
   * Start a new feature implementation wizard
   */
  async startFeature(featureId: string): Promise<{
    content: Array<{ type: string; text: string }>
  }> {
    const feature = getFeature(featureId)
    if (!feature) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Unknown feature: "${featureId}"\n\nAvailable features: authentication, blog, comments, file-upload, semantic-search`,
          },
        ],
      }
    }

    const sessionId = this.generateSessionId()
    const session = this.createSession(sessionId, feature)
    this.sessions[sessionId] = session

    const progressBar = this.renderProgressBar(1, feature.questions.length)
    const firstQuestion = this.renderQuestion(feature.questions[0], session, 1)

    return {
      content: [
        {
          type: 'text',
          text: `🚀 **${feature.name} Implementation**

${feature.description}

**What's included**:
${feature.includes.map((item) => `- ${item}`).join('\n')}

${feature.dependsOn && feature.dependsOn.length > 0 ? `\n⚠️ **Dependencies**: This feature requires: ${feature.dependsOn.join(', ')}\n` : ''}

---

## Let's configure this feature

${firstQuestion}

---

**Progress**: ${progressBar} 1/${feature.questions.length}
**Session ID**: \`${sessionId}\`

<details>
<summary>💡 **Instructions for Claude Code**</summary>

1. Present this question to the user naturally in conversation
2. When they respond, call \`opensaas_answer_feature\` with:
   - sessionId: "${sessionId}"
   - answer: <their response>
3. Continue the conversation flow with the next question
4. Keep it natural - don't mention session IDs to the user

</details>`,
        },
      ],
    }
  }

  /**
   * Process an answer and move to next question or complete the wizard
   */
  async answerQuestion(
    sessionId: string,
    answer: string | boolean | string[],
  ): Promise<{
    content: Array<{ type: string; text: string }>
  }> {
    const session = this.sessions[sessionId]
    if (!session) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Session not found: ${sessionId}\n\nPlease start a new feature implementation.`,
          },
        ],
      }
    }

    const currentQ = session.feature.questions[session.currentQuestionIndex]

    // Validate answer
    const validation = this.validateAnswer(answer, currentQ)
    if (!validation.valid) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ **Invalid answer**: ${validation.message}\n\n${this.renderQuestion(currentQ, session, session.currentQuestionIndex + 1)}`,
          },
        ],
      }
    }

    // Store answer
    session.answers[currentQ.id] = answer
    session.updatedAt = new Date()

    // Check for follow-up questions
    if (currentQ.followUp) {
      const shouldAskFollowUp =
        currentQ.followUp.if === answer ||
        (typeof currentQ.followUp.if === 'boolean' && currentQ.followUp.if === answer)

      if (shouldAskFollowUp) {
        const followUpText = `**Follow-up**: ${currentQ.followUp.ask}`
        return {
          content: [
            {
              type: 'text',
              text: `✓ Recorded: ${this.formatAnswer(answer)}\n\n${followUpText}\n\n---\n\n💡 **Claude Code**: Ask this follow-up question and call \`opensaas_answer_followup\` with sessionId "${sessionId}" and their response.`,
            },
          ],
        }
      }
    }

    // Move to next question
    session.currentQuestionIndex++

    // Check if complete
    if (session.currentQuestionIndex >= session.feature.questions.length) {
      session.isComplete = true
      return this.generateFeatureImplementation(session)
    }

    // Render next question
    const nextQ = session.feature.questions[session.currentQuestionIndex]
    const questionNum = session.currentQuestionIndex + 1
    const progressBar = this.renderProgressBar(questionNum, session.feature.questions.length)

    return {
      content: [
        {
          type: 'text',
          text: `✓ Recorded: ${this.formatAnswer(answer)}\n\n${this.renderQuestion(nextQ, session, questionNum)}\n\n---\n\n**Progress**: ${progressBar} ${questionNum}/${session.feature.questions.length}`,
        },
      ],
    }
  }

  /**
   * Handle follow-up question answers
   */
  async answerFollowUp(
    sessionId: string,
    answer: string,
  ): Promise<{
    content: Array<{ type: string; text: string }>
  }> {
    const session = this.sessions[sessionId]
    if (!session) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Session not found: ${sessionId}`,
          },
        ],
      }
    }

    const currentQ = session.feature.questions[session.currentQuestionIndex]
    const followUpKey = `${currentQ.id}_followup`

    // Store follow-up answer
    session.followUpAnswers[followUpKey] = answer
    session.updatedAt = new Date()

    // Move to next question
    session.currentQuestionIndex++

    // Check if complete
    if (session.currentQuestionIndex >= session.feature.questions.length) {
      session.isComplete = true
      return this.generateFeatureImplementation(session)
    }

    // Render next question
    const nextQ = session.feature.questions[session.currentQuestionIndex]
    const questionNum = session.currentQuestionIndex + 1
    const progressBar = this.renderProgressBar(questionNum, session.feature.questions.length)

    return {
      content: [
        {
          type: 'text',
          text: `✓ Recorded: ${answer}\n\n${this.renderQuestion(nextQ, session, questionNum)}\n\n---\n\n**Progress**: ${progressBar} ${questionNum}/${session.feature.questions.length}`,
        },
      ],
    }
  }

  /**
   * Generate the complete feature implementation
   */
  private async generateFeatureImplementation(session: WizardSession): Promise<{
    content: Array<{ type: string; text: string }>
  }> {
    const generator = new FeatureGenerator(
      session.feature,
      session.answers,
      session.followUpAnswers,
    )

    const implementation = generator.generate()

    return {
      content: [
        {
          type: 'text',
          text: `✅ **${session.feature.name} Implementation Complete!**

---

## 📝 Update \`opensaas.config.ts\`

\`\`\`typescript
${implementation.configUpdates}
\`\`\`

---

## 📁 Create these files:

${implementation.files.map((file) => `### ${file.path}\n*${file.description}*\n\n\`\`\`${file.language}\n${file.content}\n\`\`\``).join('\n\n')}

---

${
  implementation.envVars && Object.keys(implementation.envVars).length > 0
    ? `## 🔐 Environment Variables\n\nAdd these to your \`.env\` file:\n\n\`\`\`bash\n${Object.entries(
        implementation.envVars,
      )
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')}\n\`\`\`\n\n---\n\n`
    : ''
}

## 🚀 Next Steps

${implementation.nextSteps.map((step, i) => `${i + 1}. ${step}`).join('\n')}

---

## 📖 Feature Documentation

Add this to your project's \`DEVELOPMENT.md\`:

\`\`\`markdown
${implementation.devGuideSection}
\`\`\`

---

🎉 **Your ${session.feature.name} feature is ready to use!**

<details>
<summary>💡 **Troubleshooting**</summary>

If you encounter issues:
1. Ensure all dependencies are installed: \`pnpm install\`
2. Check that environment variables are set correctly
3. Run \`pnpm generate\` to update Prisma schema
4. Run \`pnpm db:push\` to update database

For more help, see the docs at https://stack.opensaas.au/

</details>`,
        },
      ],
    }
  }

  /**
   * Create a new wizard session
   */
  private createSession(sessionId: string, feature: Feature): WizardSession {
    return {
      id: sessionId,
      featureId: feature.id,
      feature,
      currentQuestionIndex: 0,
      answers: {},
      followUpAnswers: {},
      isComplete: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * Render a question for the user
   */
  private renderQuestion(
    question: FeatureQuestion,
    session: WizardSession,
    questionNum: number,
  ): string {
    let rendered = `**Question ${questionNum}**: ${question.text}\n\n`

    if (question.type === 'select' || question.type === 'multiselect') {
      rendered += question.options!.map((opt) => `- ${opt}`).join('\n')
      if (question.type === 'multiselect') {
        rendered += '\n\n*You can select multiple options (comma-separated)*'
      }
    } else if (question.type === 'boolean') {
      rendered += '*Answer: yes or no*'
    } else if (question.type === 'textarea') {
      rendered += '*Provide a detailed response*'
    }

    if (question.defaultValue !== undefined) {
      rendered += `\n\n*Default: ${this.formatAnswer(question.defaultValue)}*`
    }

    return rendered
  }

  /**
   * Validate an answer against question requirements
   */
  private validateAnswer(
    answer: string | boolean | string[],
    question: FeatureQuestion,
  ): { valid: boolean; message?: string } {
    if (question.required && !answer) {
      return { valid: false, message: 'This question is required' }
    }

    if (question.type === 'boolean' && typeof answer !== 'boolean') {
      return {
        valid: false,
        message: 'Please answer with yes/no or true/false',
      }
    }

    if (
      question.type === 'select' &&
      question.options &&
      !question.options.includes(answer as string)
    ) {
      return {
        valid: false,
        message: `Please select one of: ${question.options.join(', ')}`,
      }
    }

    if (question.type === 'multiselect' && question.options) {
      const answers = Array.isArray(answer) ? answer : [answer]
      const invalid = answers.filter((a) => typeof a === 'string' && !question.options!.includes(a))
      if (invalid.length > 0) {
        return {
          valid: false,
          message: `Invalid options: ${invalid.join(', ')}. Valid options: ${question.options.join(', ')}`,
        }
      }
    }

    return { valid: true }
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
   * Format an answer for display
   */
  private formatAnswer(answer: string | boolean | string[]): string {
    if (typeof answer === 'boolean') {
      return answer ? 'Yes' : 'No'
    }
    if (Array.isArray(answer)) {
      return answer.join(', ')
    }
    return answer
  }

  /**
   * Get session by ID (for debugging/testing)
   */
  getSession(sessionId: string): WizardSession | undefined {
    return this.sessions[sessionId]
  }

  /**
   * Clear completed sessions (cleanup)
   */
  clearCompletedSessions(): void {
    Object.keys(this.sessions).forEach((id) => {
      if (this.sessions[id].isComplete) {
        delete this.sessions[id]
      }
    })
  }
}
