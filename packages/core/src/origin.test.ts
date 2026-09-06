import { describe, it, expect } from 'vitest'
import {
  currentOrigin,
  originStore,
  originTripwire,
  preserveOrigin,
  refuseUnmarkedQuery,
  UnmarkedQueryError,
  withOrigin,
  type DraftPlanIdentity,
  type LazyQueryResult,
  type QueryOrigin,
} from './origin.js'

const plan = (lane = 'orm', kind = 'select'): DraftPlanIdentity => ({
  meta: { lane },
  ast: { kind },
})

/**
 * A stand-in for Prisma's `AsyncIterableResult`: lazy in exactly the way that
 * matters here — it records the origin at the moment a row is produced, not at
 * the moment it is constructed.
 */
function lazyRows(rows: readonly string[], seen: (QueryOrigin | undefined)[]) {
  let consumed = false
  async function* generate(): AsyncGenerator<string, void, undefined> {
    seen.push(currentOrigin())
    for (const row of rows) yield row
  }
  const iterate = (): AsyncIterator<string> => {
    if (consumed) throw new Error('already consumed')
    consumed = true
    return generate()
  }
  const collect = async (): Promise<string[]> => {
    const out: string[] = []
    const iterator = iterate()
    for (let step = await iterator.next(); !step.done; step = await iterator.next()) {
      out.push(step.value)
    }
    return out
  }
  const result: LazyQueryResult<string> = {
    [Symbol.asyncIterator]: iterate,
    toArray: collect,
    first: async () => (await collect())[0] ?? null,
    firstOrThrow: async () => {
      const rows = await collect()
      if (rows.length === 0) throw new Error('no rows')
      return rows[0]
    },
    then: (onfulfilled, onrejected) => collect().then(onfulfilled, onrejected),
  }
  return result
}

describe('withOrigin', () => {
  it('runs the function inside the origin', async () => {
    const seen = await withOrigin('engine', async () => currentOrigin())
    expect(seen).toBe('engine')
  })

  it('keeps the origin across an await inside the scope', async () => {
    const seen = await withOrigin('unsafe', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      return currentOrigin()
    })
    expect(seen).toBe('unsafe')
  })

  it('closes the scope once the function settles', async () => {
    await withOrigin('engine', async () => undefined)
    expect(currentOrigin()).toBeUndefined()
  })

  it('closes the scope when the function throws', async () => {
    await expect(
      withOrigin('engine', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(currentOrigin()).toBeUndefined()
  })

  it('does not mark work the caller deliberately leaves lazy', async () => {
    const seen: (QueryOrigin | undefined)[] = []
    const lazy = originStore.run('engine', () => lazyRows(['a'], seen))
    await lazy.toArray()
    expect(seen).toEqual([undefined])
  })
})

describe('preserveOrigin', () => {
  it('marks a value consumed by await after the scope closed', async () => {
    const seen: (QueryOrigin | undefined)[] = []
    const lazy = originStore.run('unsafe', () => preserveOrigin('unsafe', lazyRows(['a'], seen)))
    expect(currentOrigin()).toBeUndefined()
    await expect(lazy).resolves.toEqual(['a'])
    expect(seen).toEqual(['unsafe'])
  })

  it('marks a value consumed by toArray after the scope closed', async () => {
    const seen: (QueryOrigin | undefined)[] = []
    const lazy = preserveOrigin('unsafe', lazyRows(['a', 'b'], seen))
    expect(await lazy.toArray()).toEqual(['a', 'b'])
    expect(seen).toEqual(['unsafe'])
  })

  it('marks a value consumed by first and firstOrThrow', async () => {
    const seen: (QueryOrigin | undefined)[] = []
    expect(await preserveOrigin('engine', lazyRows(['a'], seen)).first()).toBe('a')
    expect(await preserveOrigin('engine', lazyRows(['b'], seen)).firstOrThrow()).toBe('b')
    expect(seen).toEqual(['engine', 'engine'])
  })

  it('marks a value streamed with for-await outside any scope', async () => {
    const seen: (QueryOrigin | undefined)[] = []
    const rows: string[] = []
    for await (const row of preserveOrigin('unsafe', lazyRows(['a', 'b'], seen))) rows.push(row)
    expect(rows).toEqual(['a', 'b'])
    expect(seen).toEqual(['unsafe'])
  })

  it('marks a value held across an await before it is consumed', async () => {
    const seen: (QueryOrigin | undefined)[] = []
    const lazy = preserveOrigin('unsafe', lazyRows(['a'], seen))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(await lazy.toArray()).toEqual(['a'])
    expect(seen).toEqual(['unsafe'])
  })

  it('forwards the iterator return and throw channels inside the scope', async () => {
    const seen: (QueryOrigin | undefined)[] = []
    const returned: (QueryOrigin | undefined)[] = []
    const source: LazyQueryResult<string> = {
      ...lazyRows(['a'], seen),
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: 'a' }),
        return: async () => {
          returned.push(currentOrigin())
          return { done: true, value: undefined }
        },
        throw: async () => {
          returned.push(currentOrigin())
          return { done: true, value: undefined }
        },
      }),
    }
    const iterator = preserveOrigin('engine', source)[Symbol.asyncIterator]()
    await iterator.return?.(undefined)
    await iterator.throw?.(new Error('x'))
    expect(returned).toEqual(['engine', 'engine'])
  })

  it('rejects through the wrapper when the underlying result rejects', async () => {
    const failing: LazyQueryResult<string> = {
      ...lazyRows([], []),
      toArray: async () => {
        throw new Error('query failed')
      },
    }
    await expect(preserveOrigin('unsafe', failing).toArray()).rejects.toThrow('query failed')
  })
})

describe('the tripwire', () => {
  it('throws the refusal error when no origin is in scope', () => {
    expect(() => refuseUnmarkedQuery(plan())).toThrow(UnmarkedQueryError)
  })

  it('names the lane and the AST kind of the refused plan', () => {
    try {
      refuseUnmarkedQuery(plan('raw', 'rawQuery'))
      expect.unreachable('should have refused')
    } catch (error) {
      expect(error).toBeInstanceOf(UnmarkedQueryError)
      if (!(error instanceof UnmarkedQueryError)) throw error
      expect(error.name).toBe('UnmarkedQueryError')
      expect(error.lane).toBe('raw')
      expect(error.kind).toBe('rawQuery')
      expect(error.message).toContain('raw/rawQuery')
    }
  })

  it('passes on either present origin', async () => {
    await withOrigin('engine', async () => refuseUnmarkedQuery(plan()))
    await withOrigin('unsafe', async () => refuseUnmarkedQuery(plan()))
  })

  it('refuses a plan compiled from als.exit inside a scope', async () => {
    await withOrigin('engine', async () => {
      originStore.exit(() => {
        expect(() => refuseUnmarkedQuery(plan())).toThrow(UnmarkedQueryError)
      })
      refuseUnmarkedQuery(plan())
    })
  })

  it('refuses regardless of NODE_ENV — it has no warn or dev-only mode', () => {
    const original = process.env.NODE_ENV
    try {
      for (const env of ['development', 'test', 'production']) {
        process.env.NODE_ENV = env
        expect(() => refuseUnmarkedQuery(plan())).toThrow(UnmarkedQueryError)
      }
    } finally {
      process.env.NODE_ENV = original
    }
  })

  it('is one installable middleware value that never rewrites the plan', async () => {
    expect(originTripwire.name).toBe('opensaas-origin-tripwire')
    expect(originTripwire.familyId).toBe('sql')
    expect(typeof originTripwire.beforeCompile).toBe('function')
    expect(originTripwire.beforeExecute).toBeUndefined()
    expect(originTripwire.afterExecute).toBeUndefined()
  })
})

describe('isolation between concurrent origins', () => {
  it('gives interleaved engine, unsafe and foreign calls exactly their own origin', async () => {
    const observe = async (label: string): Promise<[string, QueryOrigin | undefined]> => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 5))
      return [label, currentOrigin()]
    }

    const calls: Promise<[string, QueryOrigin | undefined]>[] = []
    for (let index = 0; index < 30; index++) {
      calls.push(withOrigin('engine', () => observe(`engine-${index}`)))
      calls.push(withOrigin('unsafe', () => observe(`unsafe-${index}`)))
      calls.push(observe(`foreign-${index}`))
    }

    for (const [label, origin] of await Promise.all(calls)) {
      expect(origin).toBe(label.startsWith('foreign') ? undefined : label.split('-')[0])
    }
  })

  it('keeps a wrapped lazy result on its own origin while others run', async () => {
    const engineSeen: (QueryOrigin | undefined)[] = []
    const unsafeSeen: (QueryOrigin | undefined)[] = []
    const engineLazy = preserveOrigin('engine', lazyRows(['a'], engineSeen))
    const unsafeLazy = preserveOrigin('unsafe', lazyRows(['b'], unsafeSeen))

    await withOrigin('unsafe', async () => {
      await engineLazy.toArray()
      return undefined
    })
    await withOrigin('engine', async () => {
      await unsafeLazy.toArray()
      return undefined
    })

    expect(engineSeen).toEqual(['engine'])
    expect(unsafeSeen).toEqual(['unsafe'])
  })
})
