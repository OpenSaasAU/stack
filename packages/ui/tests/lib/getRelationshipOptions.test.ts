import { describe, it, expect, vi } from 'vitest'
import { getRelationshipOptions } from '../../src/lib/getRelationshipOptions.js'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'

interface DelegateStub {
  findMany: (args?: unknown) => Promise<Array<Record<string, unknown>>>
  findFirst: (args?: unknown) => Promise<Record<string, unknown> | null>
}

function makeContext(delegates: Record<string, DelegateStub>): AccessContext<unknown> {
  const context = {
    db: delegates,
    session: null,
    storage: {},
    plugins: {},
    _isSudo: false,
    _resolveOutputChain: [],
  }
  return context as unknown as AccessContext<unknown>
}

describe('getRelationshipOptions (stack-ui re-export)', () => {
  it('resolves { id, label }[] for a relationship field against a full AccessContext', async () => {
    const findMany = vi.fn(async () => [
      { id: 'u1', name: 'Ada Lovelace' },
      { id: 'u2', name: 'Alan Turing' },
    ])
    const context = makeContext({ user: { findMany, findFirst: vi.fn() } })

    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {
        User: {
          fields: { name: { type: 'text' } },
          access: { operation: { query: () => true } },
        },
      },
    }

    const result = await getRelationshipOptions(context, config, 'User', {})

    expect(result).toEqual([
      { id: 'u1', label: 'Ada Lovelace' },
      { id: 'u2', label: 'Alan Turing' },
    ])
    expect(findMany.mock.calls[0][0]).not.toHaveProperty('include')
  })

  it('returns [] for an unknown related list', async () => {
    const context = makeContext({})
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {},
    }

    expect(await getRelationshipOptions(context, config, 'Missing', {})).toEqual([])
  })
})
