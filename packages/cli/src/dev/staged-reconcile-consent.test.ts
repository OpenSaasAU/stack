import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../generator/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../generator/index.js')>()),
  runPrismaCli: vi.fn(),
}))

import { runPrismaCli } from '../generator/index.js'
import { planDatabaseUpdate } from './staged-reconcile.js'

const resultLine = JSON.stringify({
  kind: 'result',
  envelope: { result: { accessChanges: [], plan: { operations: [] } } },
})

describe('replaying a plan with consent', () => {
  beforeEach(() => {
    vi.mocked(runPrismaCli).mockReset()
    vi.mocked(runPrismaCli).mockResolvedValue({
      exitCode: 0,
      signal: null,
      output: resultLine,
      stdout: resultLine,
    })
  })

  it('passes each access change as --allow and each data loss as --delete', async () => {
    await planDatabaseUpdate('/cwd', 'prisma.config.ts', {
      consent: {
        operations: [],
        statements: [],
        dataLoss: ['Post.title'],
        accessChanges: ['Post'],
        destructive: true,
      },
    })
    const args = vi.mocked(runPrismaCli).mock.calls[0]?.[1] ?? []
    expect(args).toEqual(expect.arrayContaining(['--delete', 'Post.title', '--allow', 'Post']))
  })
})
