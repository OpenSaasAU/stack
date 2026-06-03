import { describe, it, expect, vi, afterEach } from 'vitest'
import { MigrationWizard } from './migration-wizard.js'
import { MigrationGenerator } from '../../../migration/generators/migration-generator.js'
import { MIGRATION_GUIDE_URL } from '../../../commands/migrate.js'

function getSessionId(text: string): string {
  const match = text.match(/sessionId`?:?\s*"(migration_[^"]+)"/)
  if (!match) {
    throw new Error(`Could not find sessionId in wizard output:\n${text}`)
  }
  return match[1]
}

describe('MigrationWizard config-generation failure', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('points users at the canonical Keystone migration guide when generation fails', async () => {
    // Force the underlying generator to throw so we exercise the catch branch.
    vi.spyOn(MigrationGenerator.prototype, 'generate').mockRejectedValue(new Error('boom'))

    const wizard = new MigrationWizard()

    // Keystone fast-path: db_provider, enable_auth, (auth_methods skipped), confirm.
    const start = await wizard.startMigration('keystone')
    const sessionId = getSessionId(start.content[0].text)

    await wizard.answerQuestion(sessionId, 'sqlite') // db_provider
    await wizard.answerQuestion(sessionId, false) // enable_auth (skips auth_methods)
    const final = await wizard.answerQuestion(sessionId, true) // confirm -> generates

    const text = final.content[0].text
    expect(text).toContain('Failed to generate config')
    // Uses the shared canonical constant, not the stale (404) path.
    expect(text).toContain(MIGRATION_GUIDE_URL)
    expect(text).not.toContain('https://stack.opensaas.au/guides/migration')
  })
})
