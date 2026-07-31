import { describe, it, expect, vi } from 'vitest'
import { isListQueryStaticallyDenied, resolveNavCounts } from '../src/config/nav-count.js'
import type { AccessContext } from '../src/access/types.js'
import type { ListConfig, OpenSaasConfig, TypeInfo } from '../src/config/types.js'

/**
 * Build a list config with a chosen query access and `ui.navCount` / singleton
 * flags. Access is written in the normalized object form `list()` produces.
 */
function makeList(options: {
  queryAccess?: boolean | (() => boolean) | undefined
  navCount?: boolean
  isSingleton?: boolean
}): ListConfig<TypeInfo> {
  const { queryAccess, navCount, isSingleton } = options
  return {
    fields: { title: { type: 'text' } as ListConfig<TypeInfo>['fields'][string] },
    access: queryAccess === undefined ? undefined : { operation: { query: queryAccess } },
    ui: navCount !== undefined ? { navCount } : undefined,
    isSingleton,
  } as ListConfig<TypeInfo>
}

/**
 * A context whose `db[key].count` is a spy resolving to a fixed number, so we
 * can assert both the returned counts and WHICH lists were queried.
 */
function makeContext(counts: Record<string, number>): {
  context: AccessContext
  spies: Record<string, ReturnType<typeof vi.fn>>
} {
  const spies: Record<string, ReturnType<typeof vi.fn>> = {}
  const db: Record<string, { count: ReturnType<typeof vi.fn> }> = {}
  for (const [dbKey, value] of Object.entries(counts)) {
    const spy = vi.fn(async () => value)
    spies[dbKey] = spy
    db[dbKey] = { count: spy }
  }
  const context = {
    db,
    session: null,
    prisma: {},
    storage: {},
    plugins: {},
    _isSudo: false,
    _resolveOutputChain: [],
  } as unknown as AccessContext
  return { context, spies }
}

describe('isListQueryStaticallyDenied', () => {
  it('is denied when query access is absent (deny-by-default)', () => {
    expect(isListQueryStaticallyDenied(makeList({ queryAccess: undefined }))).toBe(true)
  })

  it('is denied when query access is the literal false', () => {
    expect(isListQueryStaticallyDenied(makeList({ queryAccess: false }))).toBe(true)
  })

  it('is not denied when query access is the literal true', () => {
    expect(isListQueryStaticallyDenied(makeList({ queryAccess: true }))).toBe(false)
  })

  it('is not denied when query access is a function (decided per request)', () => {
    expect(isListQueryStaticallyDenied(makeList({ queryAccess: () => false }))).toBe(false)
  })
})

describe('resolveNavCounts', () => {
  it('counts only lists that opt in via ui.navCount', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./t.db' },
      lists: {
        Post: makeList({ queryAccess: true, navCount: true }),
        Comment: makeList({ queryAccess: true, navCount: false }),
        Tag: makeList({ queryAccess: true }), // no ui.navCount at all
      },
    }
    const { context, spies } = makeContext({ post: 3, comment: 9, tag: 2 })

    const counts = await resolveNavCounts(context, config)

    expect(counts).toEqual({ Post: 3 })
    // No count query runs for lists that didn't opt in.
    expect(spies.post).toHaveBeenCalledTimes(1)
    expect(spies.comment).not.toHaveBeenCalled()
    expect(spies.tag).not.toHaveBeenCalled()
  })

  it('omits an opted-in list whose query access is statically denied (no misleading zero, no query)', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./t.db' },
      lists: {
        Secret: makeList({ queryAccess: false, navCount: true }),
        Missing: makeList({ queryAccess: undefined, navCount: true }),
      },
    }
    const { context, spies } = makeContext({ secret: 5, missing: 5 })

    const counts = await resolveNavCounts(context, config)

    expect(counts).toEqual({})
    expect(spies.secret).not.toHaveBeenCalled()
    expect(spies.missing).not.toHaveBeenCalled()
  })

  it('counts a list with function query access through the secured context', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./t.db' },
      lists: {
        Post: makeList({ queryAccess: () => true, navCount: true }),
      },
    }
    const { context, spies } = makeContext({ post: 7 })

    const counts = await resolveNavCounts(context, config)

    expect(counts).toEqual({ Post: 7 })
    expect(spies.post).toHaveBeenCalledTimes(1)
  })

  it('reports an access-scoped count of zero (session sees none) as 0, not omitted', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./t.db' },
      lists: {
        Post: makeList({ queryAccess: () => true, navCount: true }),
      },
    }
    const { context } = makeContext({ post: 0 })

    const counts = await resolveNavCounts(context, config)

    expect(counts).toEqual({ Post: 0 })
  })

  it('skips singletons even when opted in (a single-record list has no meaningful count)', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./t.db' },
      lists: {
        SiteSettings: makeList({ queryAccess: true, navCount: true, isSingleton: true }),
      },
    }
    const { context, spies } = makeContext({ siteSettings: 1 })

    const counts = await resolveNavCounts(context, config)

    expect(counts).toEqual({})
    expect(spies.siteSettings).not.toHaveBeenCalled()
  })

  it("degrades gracefully when one list's count rejects — omits that badge, keeps the rest, never throws", async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./t.db' },
      lists: {
        Post: makeList({ queryAccess: true, navCount: true }),
        Comment: makeList({ queryAccess: true, navCount: true }),
      },
    }
    // Post's count throws (e.g. a DB hiccup or a throwing access filter);
    // Comment's succeeds. The whole admin chrome must still render.
    const context = {
      db: {
        post: { count: async () => Promise.reject(new Error('db exploded')) },
        comment: { count: async () => 4 },
      },
      session: null,
      prisma: {},
      storage: {},
      plugins: {},
      _isSudo: false,
      _resolveOutputChain: [],
    } as unknown as AccessContext

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const counts = await resolveNavCounts(context, config)

      // Rejecting list is omitted; the healthy list's count is unaffected.
      expect(counts).toEqual({ Comment: 4 })
      // The failure is logged, not swallowed silently.
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve nav count for Post'),
        expect.any(Error),
      )
    } finally {
      errorSpy.mockRestore()
    }
  })
})
