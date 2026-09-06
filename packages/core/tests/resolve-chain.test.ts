import { describe, it, expect, vi } from 'vitest'
import { getContext } from '../src/context/index.js'
import { virtual, text, relationship } from '../src/fields/index.js'
import { ResolveOutputCycleError } from '../src/access/index.js'
import { RESOLVE_CHAIN_MAX_LENGTH } from '../src/access/depth-limits.js'
import type { OpenSaasConfig } from '../src/config/types.js'

/**
 * Regression coverage for issue #844 / ADR-0023: a `resolveOutput` hook that
 * issues its own read used to be able to recurse without bound, because the
 * only guard was a boolean read of a mutable counter shared by the whole
 * request. The fix is a resolve chain — an ordered list of `(list, field)`
 * pairs, extended by deriving a NEW context per hook invocation rather than
 * mutating one shared value — with a cycle guard that refuses to re-enter a
 * pair already on the chain, and a separate, non-fatal cost cap.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeModel(): any {
  return { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn() }
}

describe('resolve chain — cycle guard terminates hook-issued reads (#844)', () => {
  it('two lists with no relationship fields, whose virtual hooks read each other, throw the cycle error instead of recursing', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Ping: {
          fields: {
            label: virtual({
              type: 'string',
              hooks: {
                resolveOutput: async ({ context }) => {
                  await context.db.pong.findMany({})
                  return 'ping'
                },
              },
            }),
          },
          access: { operation: { query: () => true } },
        },
        Pong: {
          fields: {
            label: virtual({
              type: 'string',
              hooks: {
                resolveOutput: async ({ context }) => {
                  await context.db.ping.findMany({})
                  return 'pong'
                },
              },
            }),
          },
          access: { operation: { query: () => true } },
        },
      },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ormHandle: any = { ping: makeModel(), pong: makeModel() }
    ormHandle.ping.findMany.mockResolvedValue([{ id: 'p1' }])
    ormHandle.pong.findMany.mockResolvedValue([{ id: 'q1' }])

    const context = await getContext(config, ormHandle, null)

    await expect(context.db.ping.findMany({})).rejects.toThrow(ResolveOutputCycleError)

    // The cycle must be caught within a handful of hops, never left to grow
    // toward the hundreds of queries the un-bounded chain produced (#844).
    const totalCalls =
      ormHandle.ping.findMany.mock.calls.length + ormHandle.pong.findMany.mock.calls.length
    expect(totalCalls).toBeLessThan(10)
  })

  it('names every (list, field) pair on the chain in order, including the repeat', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Ping: {
          fields: {
            label: virtual({
              type: 'string',
              hooks: {
                resolveOutput: async ({ context }) => {
                  await context.db.pong.findMany({})
                  return 'ping'
                },
              },
            }),
          },
          access: { operation: { query: () => true } },
        },
        Pong: {
          fields: {
            label: virtual({
              type: 'string',
              hooks: {
                resolveOutput: async ({ context }) => {
                  await context.db.ping.findMany({})
                  return 'pong'
                },
              },
            }),
          },
          access: { operation: { query: () => true } },
        },
      },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ormHandle: any = { ping: makeModel(), pong: makeModel() }
    ormHandle.ping.findMany.mockResolvedValue([{ id: 'p1' }])
    ormHandle.pong.findMany.mockResolvedValue([{ id: 'q1' }])

    const context = await getContext(config, ormHandle, null)

    let caught: unknown
    try {
      await context.db.ping.findMany({})
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ResolveOutputCycleError)
    const err = caught as ResolveOutputCycleError
    expect(err.chain).toEqual([
      { listKey: 'Ping', fieldKey: 'label' },
      { listKey: 'Pong', fieldKey: 'label' },
      { listKey: 'Ping', fieldKey: 'label' },
    ])
    expect(err.message).toBe(
      'resolveOutput cycle detected: Ping.label → Pong.label → Ping.label. A hook that ' +
        're-enters a (list, field) pair already on its own resolve chain cannot terminate, so ' +
        'the read is refused rather than left to recurse until the process runs out of memory. ' +
        'Restructure the hooks so the read does not loop back into itself.',
    )
  })

  it("no longer reproduces the reporter's 3-list cyclic schema (User → Account → Student) on a bare hook-issued read (#848, ADR-0024)", async () => {
    // Sketch matches the issue's minimal reproduction: User.name reads
    // Account, whose Student rows' own virtual field reads Account again. The
    // hook's read is BARE (no `include`), so under ADR-0024 it fetches
    // Account's own columns only — `students` is never fetched, the walk into
    // `Student.label` never happens, and the cycle cannot form.
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: {
          fields: {
            accounts: relationship({ ref: 'Account.user', many: true }),
            name: virtual({
              type: 'string',
              hooks: {
                resolveOutput: async ({ item, context }) => {
                  const [a] = await context.db.account.findMany({
                    where: { userId: item.id },
                    take: 1,
                  })
                  return `${(a as { firstName?: string } | undefined)?.firstName}`
                },
              },
            }),
          },
          access: { operation: { query: () => true } },
        },
        Account: {
          fields: {
            firstName: text(),
            user: relationship({ ref: 'User.accounts' }),
            students: relationship({ ref: 'Student.account', many: true }),
          },
          access: { operation: { query: () => true } },
        },
        Student: {
          fields: {
            account: relationship({ ref: 'Account.students' }),
            label: virtual({
              type: 'string',
              hooks: {
                resolveOutput: async ({ item, context }) => {
                  const a = await context.db.account.findUnique({
                    where: { id: item.accountId },
                  })
                  return `${(a as { firstName?: string } | undefined)?.firstName}`
                },
              },
            }),
          },
          access: { operation: { query: () => true } },
        },
      },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ormHandle: any = { user: makeModel(), account: makeModel(), student: makeModel() }
    ormHandle.user.findMany.mockResolvedValue([{ id: 'u1' }])
    // Mirrors real Prisma semantics: a relation key is only present on the
    // returned row when the caller actually asked for it via `include`. The
    // hook's read never does, so `students` (and `user`) never appear here —
    // that is the mechanism that breaks the cycle under ADR-0024.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ormHandle.account.findMany.mockImplementation((args: any = {}) => {
      const row: Record<string, unknown> = { id: 'a1', firstName: 'Ann' }
      if (args.include?.students) row.students = [{ id: 's1', accountId: 'a1' }]
      if (args.include?.user) row.user = { id: 'u1' }
      return Promise.resolve([row])
    })
    // `context.db.<list>.findUnique` is implemented via the Prisma model's
    // `findFirst` (see `createFindUnique` in `context/index.ts`), not its
    // `findUnique` — mock the method actually called.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ormHandle.account.findFirst.mockImplementation((args: any = {}) => {
      const row: Record<string, unknown> = { id: 'a1', firstName: 'Ann' }
      if (args.include?.students) row.students = [{ id: 's1', accountId: 'a1' }]
      if (args.include?.user) row.user = { id: 'u1' }
      return Promise.resolve(row)
    })

    const context = await getContext(config, ormHandle, null)

    // Must settle (not hang or throw) — the bare hook-issued read never
    // fetches `students`, so `Student.label` never fires and there is no
    // cycle to detect.
    const result = await context.db.user.findMany({})
    expect(result).toEqual([{ id: 'u1', name: 'Ann' }])

    // Only the two reads the hook actually issues — no unbounded recursion.
    const totalCalls =
      ormHandle.user.findMany.mock.calls.length +
      ormHandle.account.findMany.mock.calls.length +
      ormHandle.account.findFirst.mock.calls.length
    expect(totalCalls).toBe(2)
  })
})

describe('resolve chain — cost cap is a warning, not a denial (#844)', () => {
  it('an acyclic chain longer than RESOLVE_CHAIN_MAX_LENGTH omits the field and warns once, without throwing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    // A straight-line chain of distinct lists L0 → L1 → … so no (list, field)
    // pair ever repeats — this chain is acyclic and would terminate on its
    // own; it only needs to be capped as a cost limit.
    const listCount = RESOLVE_CHAIN_MAX_LENGTH + 3
    const lists: OpenSaasConfig['lists'] = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ormHandle: any = {}
    for (let i = 0; i < listCount; i++) {
      const listKey = `L${i}`
      const dbKey = `l${i}`
      const nextDbKey = `l${i + 1}`
      lists[listKey] = {
        fields: {
          next: virtual({
            type: 'string',
            hooks: {
              resolveOutput:
                i < listCount - 1
                  ? async ({ context }) => {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      await (context.db as any)[nextDbKey].findMany({})
                      return 'ok'
                    }
                  : () => 'leaf',
            },
          }),
        },
        access: { operation: { query: () => true } },
      }
      ormHandle[dbKey] = makeModel()
      ormHandle[dbKey].findMany.mockResolvedValue([{ id: `${dbKey}-row` }])
    }

    const config: OpenSaasConfig = {
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists,
    }

    const context = await getContext(config, ormHandle, null)

    // Does NOT throw — a cap hit is a cost limit, never a correctness denial.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (context.db as any).l0.findMany({})
    expect(result).toBeTruthy()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain('RESOLVE_CHAIN_MAX_LENGTH')

    // Nothing past the cap is ever queried — the chain simply stops growing.
    for (let i = RESOLVE_CHAIN_MAX_LENGTH + 1; i < listCount; i++) {
      expect(ormHandle[`l${i}`].findMany).not.toHaveBeenCalled()
    }

    warnSpy.mockRestore()
  })
})

describe('resolve chain — concurrent hook invocations are isolated (#844)', () => {
  it('sibling rows in a to-many read each observe their own chain of length 1, not a racing shared counter', async () => {
    const observedLengths: number[] = []

    const config: OpenSaasConfig = {
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Widget: {
          fields: {
            tag: virtual({
              type: 'string',
              hooks: {
                resolveOutput: async ({ context }) => {
                  // Stagger completion so the three hook invocations
                  // genuinely interleave rather than running back-to-back.
                  await new Promise((resolve) => setTimeout(resolve, Math.random() * 5))
                  observedLengths.push(context._resolveOutputChain.length)
                  return 'tag'
                },
              },
            }),
          },
          access: { operation: { query: () => true } },
        },
      },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ormHandle: any = { widget: makeModel() }
    ormHandle.widget.findMany.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }])

    const context = await getContext(config, ormHandle, null)
    await context.db.widget.findMany({})

    expect(observedLengths.sort()).toEqual([1, 1, 1])
  })

  it('an unrelated top-level read in flight alongside a hook still gets its own explicit include scoped', async () => {
    let releaseSlowHook: () => void = () => {}

    const config: OpenSaasConfig = {
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Slow: {
          fields: {
            tag: virtual({
              type: 'string',
              hooks: {
                resolveOutput: async () => {
                  await new Promise<void>((resolve) => {
                    releaseSlowHook = resolve
                  })
                  return 'tag'
                },
              },
            }),
          },
          access: { operation: { query: () => true } },
        },
        Fast: {
          fields: {
            name: text(),
            child: relationship({ ref: 'FastChild' }),
          },
          access: { operation: { query: () => true } },
        },
        FastChild: {
          fields: {
            label: text(),
            grandchild: relationship({ ref: 'FastGrandchild' }),
          },
          access: { operation: { query: () => true } },
        },
        FastGrandchild: {
          fields: { value: text() },
          access: { operation: { query: () => true } },
        },
      },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ormHandle: any = { slow: makeModel(), fast: makeModel() }
    ormHandle.slow.findMany.mockResolvedValue([{ id: 'sl1' }])
    ormHandle.fast.findMany.mockResolvedValue([{ id: 'f1' }])

    const context = await getContext(config, ormHandle, null)

    // Start the slow read — it blocks inside Slow.tag's hook until released.
    const slowPromise = context.db.slow.findMany({})

    // Let the slow hook actually start (and derive its context) before racing
    // the unrelated read against it.
    await new Promise((resolve) => setTimeout(resolve, 0))

    // While the slow hook is still in flight, issue a plain top-level read
    // that has nothing to do with it, explicitly naming a nested path two
    // levels deep (child → grandchild) — the "One hop" rule (ADR-0026) means
    // reaching grandchild requires naming it, which this request does.
    const fastPromise = context.db.fast.findMany({
      include: { child: { include: { grandchild: true } } },
    })

    await fastPromise
    releaseSlowHook()
    await slowPromise

    // The unrelated read's access-controlled scoping must descend exactly as
    // far as ITS OWN request named, unaffected by a totally different read's
    // hook being in flight concurrently — no shared, leaking context state
    // between the two.
    expect(ormHandle.fast.findMany.mock.calls[0][0].include).toEqual({
      child: { include: { grandchild: true } },
    })
  })
})
