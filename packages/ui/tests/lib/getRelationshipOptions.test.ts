import { describe, it, expect, vi } from 'vitest'
import { getRelationshipOptions } from '../../src/lib/getRelationshipOptions.js'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'

interface DelegateStub {
  where: (predicate: unknown) => DelegateStub
  orderBy: (order: unknown) => DelegateStub
  select: (...fields: readonly string[]) => DelegateStub
  limit: (count: number) => DelegateStub
  all: () => Promise<Array<Record<string, unknown>>>
}

/** A composed-read double: every member returns itself, and `all()` answers. */
function makeDelegate(all: () => Promise<Array<Record<string, unknown>>>): DelegateStub {
  const stub: DelegateStub = {
    where: () => stub,
    orderBy: () => stub,
    select: () => stub,
    limit: () => stub,
    all,
  }
  return stub
}

function makeContext(delegates: Record<string, DelegateStub>): AccessContext {
  const context = {
    db: delegates,
    session: null,
    storage: {},
    plugins: {},
    _isSudo: false,
    _resolveOutputChain: [],
  }
  return context as unknown as AccessContext
}

describe('getRelationshipOptions (stack-ui re-export)', () => {
  it('resolves { id, label }[] for a relationship field against a full AccessContext', async () => {
    const all = vi.fn(async () => [
      { id: 'u1', name: 'Ada Lovelace' },
      { id: 'u2', name: 'Alan Turing' },
    ])
    const select = vi.fn()
    const user = makeDelegate(all)
    user.select = (...fields: readonly string[]) => {
      select(fields)
      return user
    }
    const context = makeContext({ User: user })

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
    expect(select.mock.calls[0][0]).toEqual(['id', 'name'])
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
