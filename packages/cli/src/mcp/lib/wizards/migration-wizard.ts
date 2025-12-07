/**
 * Migration wizard - Stub for Phase 3
 *
 * This will guide users through the migration process with interactive questions
 */

import type { ProjectType } from '../../../migration/types.js'

export class MigrationWizard {
  /**
   * Start a new migration wizard session
   *
   * @param projectType - Type of project being migrated
   * @returns MCP response with first question
   */
  async startMigration(projectType: ProjectType) {
    // Stub - will be implemented in Phase 3
    return {
      content: [
        {
          type: 'text' as const,
          text: `🚧 **Migration Wizard Coming Soon**

The migration wizard for ${projectType} projects is currently under development and will be available in Phase 3.

**What it will do:**
- Analyze your existing ${projectType} project
- Ask questions about your requirements
- Generate a complete OpenSaaS config
- Provide step-by-step migration instructions

**Current workaround:**
Use \`opensaas_introspect_${projectType === 'keystone' ? 'keystone' : 'prisma'}\` to analyze your schema, then manually create an opensaas.config.ts based on the output.

**Need help?** Use \`opensaas_feature_docs({ topic: "migration" })\` for migration guides.`,
        },
      ],
    }
  }

  /**
   * Answer a question in the migration wizard
   *
   * @param sessionId - Migration session ID
   * @param answer - User's answer to the current question
   * @returns MCP response with next question or completion
   */
  async answerQuestion(_sessionId: string, _answer: string | boolean | string[]) {
    // Stub - will be implemented in Phase 3
    return {
      content: [
        {
          type: 'text' as const,
          text: '🚧 Migration wizard not yet implemented. This will be available in Phase 3.',
        },
      ],
    }
  }
}
