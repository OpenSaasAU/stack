import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  runWritePipeline,
  createWriteStrategy,
  updateWriteStrategy,
  deleteWriteStrategy,
} from '../src/context/write-pipeline.js'
import { ValidationError } from '../src/hooks/index.js'
import { InvalidCreateAccessResultError } from '../src/access/errors.js'
import { text } from '../src/fields/index.js'
import type { OpenSaasConfig, ListConfig } from '../src/config/types.js'
import type { AccessContext, OrmClient } from '../src/access/types.js'
import { rc8Collection } from './rc8-collection.js'

/**
 * Unit tests for the Write Pipeline — the single module that owns the canonical
 * secured write sequence. These drive the pipeline directly through its
 * interface (fake Prisma model + spy hooks + a list config), which is the whole
 * point of the deepening: the phase order becomes the test surface.
 *
 * Asserted once, across create/update/delete:
 *   - phases run in the documented order;
 *   - access denial / missing target / filter non-match short-circuit to `null`
 *     BEFORE the DB call and BEFORE beforeOperation;
 *   - validation failure throws ValidationError and never hits the DB;
 *   - sudo bypasses access + writable filtering;
 *   - afterOperation sees the persisted row and the correct originalItem.
 */

// Shared ordered log of phase events for order assertions.
let events: string[]

/**
 * Build a fake rc.8 collection whose members log their calls. The pipeline
 * resolves the collection dynamically by list key ('Post').
 *
 * `existing` answers the target read and `filterMatch` the second read a
 * filter result triggers — the two `first()` calls the update/delete strategy
 * makes, in that order.
 */
function makeFakePrisma(overrides?: {
  existing?: Record<string, unknown> | null
  filterMatch?: Record<string, unknown> | null
  created?: Record<string, unknown>
  updated?: Record<string, unknown>
  deleted?: Record<string, unknown>
  rows?: number
}) {
  const post = rc8Collection({
    first: [overrides?.existing ?? null, overrides?.filterMatch ?? null],
    create: overrides?.created ?? { id: '1', title: 'created' },
    update: overrides?.updated ?? { id: '1', title: 'updated' },
    delete: overrides?.deleted ?? { id: '1', title: 'deleted' },
    rows: overrides?.rows ?? 0,
    onCall: (member) => events.push(`db:${member}`),
  })

  return { ormHandle: { Post: post } as unknown as OrmClient, post }
}

/**
 * Build a minimal AccessContext for the pipeline.
 */
function makeContext(opts?: { isSudo?: boolean }): AccessContext {
  return {
    session: { userId: 'u1' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ormHandle: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    storage: {} as any,
    plugins: {},
    _isSudo: opts?.isSudo ?? false,
    _resolveOutputChain: [],
  }
}

/**
 * A list config with a spy on every hook, recording its phase into `events`.
 * `title` is a required field so we can exercise built-in field rules.
 */
function makeListConfig(opts?: {
  operationAccess?: {
    create?: () => boolean | Record<string, unknown>
    update?: () => boolean | Record<string, unknown>
    delete?: () => boolean | Record<string, unknown>
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): ListConfig<any> {
  return {
    fields: {
      // Use the real text() builder so built-in field rules (isRequired) and
      // getZodSchema actually exist, while spying on each hook phase.
      // The Access Filter below scopes by this column, and it is lowered
      // through the Where vocabulary like any other predicate — so the list
      // has to declare it.
      authorId: text(),
      title: text({
        validation: { isRequired: true },
        hooks: {
          resolveInput: async ({ resolvedData, fieldKey }) => {
            events.push('field:resolveInput')
            return resolvedData[fieldKey]
          },
          validate: async () => {
            events.push('field:validate')
          },
          beforeOperation: async () => {
            events.push('field:beforeOperation')
          },
          afterOperation: async () => {
            events.push('field:afterOperation')
          },
        },
      }),
    },
    access: {
      operation: {
        query: () => true,
        create: opts?.operationAccess?.create ?? (() => true),
        update: opts?.operationAccess?.update ?? (() => true),
        delete: opts?.operationAccess?.delete ?? (() => true),
      },
    },
    hooks: {
      resolveInput: async ({ resolvedData }) => {
        events.push('list:resolveInput')
        return resolvedData
      },
      validate: async () => {
        events.push('list:validate')
      },
      beforeOperation: async () => {
        events.push('list:beforeOperation')
      },
      afterOperation: async () => {
        events.push('list:afterOperation')
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as ListConfig<any>
}

function makeConfig(listConfig: ListConfig<unknown>): OpenSaasConfig {
  return {
    db: { provider: 'sqlite' },
    lists: { Post: listConfig },
  } as unknown as OpenSaasConfig
}

beforeEach(() => {
  events = []
})

describe('Write Pipeline — phase order', () => {
  it('runs create phases in the documented order (resolveInput → validate → beforeOp → DB → afterOp → Field Visibility)', async () => {
    const { ormHandle, post } = makeFakePrisma({ created: { id: '1', title: 'hi' } })
    const listConfig = makeListConfig()
    const context = makeContext()

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      ormHandle,
      context,
      config: makeConfig(listConfig),
      inputData: { title: 'hi' },
      strategy: createWriteStrategy('Post', listConfig, context),
    })

    expect(result).toEqual({ id: '1', title: 'hi' })
    // The DB call must come AFTER all input/validate/before hooks and BEFORE after hooks.
    expect(events).toEqual([
      'list:resolveInput',
      'field:resolveInput',
      'list:validate',
      'field:validate',
      'field:beforeOperation',
      'list:beforeOperation',
      'db:create',
      'list:afterOperation',
      'field:afterOperation',
    ])
    // resolveInput strictly precedes validate, which precedes the DB write.
    expect(events.indexOf('list:resolveInput')).toBeLessThan(events.indexOf('list:validate'))
    expect(events.indexOf('list:validate')).toBeLessThan(events.indexOf('db:create'))
    expect(events.indexOf('db:create')).toBeLessThan(events.indexOf('list:afterOperation'))
    expect(post.create).toHaveBeenCalledTimes(1)
  })

  it('runs update phases in the documented order, fetching the target first', async () => {
    const existing = { id: '1', title: 'old' }
    const { ormHandle, post } = makeFakePrisma({ existing, updated: { id: '1', title: 'new' } })
    const listConfig = makeListConfig()
    const context = makeContext()

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      ormHandle,
      context,
      config: makeConfig(listConfig),
      inputData: { title: 'new' },
      strategy: updateWriteStrategy('Post', listConfig, makeConfig(listConfig), context, {
        id: '1',
      }),
    })

    expect(result).toEqual({ id: '1', title: 'new' })
    expect(events).toEqual([
      'db:first',
      'list:resolveInput',
      'field:resolveInput',
      'list:validate',
      'field:validate',
      'field:beforeOperation',
      'list:beforeOperation',
      'db:update',
      'list:afterOperation',
      'field:afterOperation',
    ])
    expect(post.update).toHaveBeenCalledTimes(1)
  })

  it('runs delete phases in the documented order, SKIPPING the input-shaping phases', async () => {
    const existing = { id: '1', title: 'doomed' }
    const { ormHandle, post } = makeFakePrisma({ existing, deleted: existing })
    const listConfig = makeListConfig()
    const context = makeContext()

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      ormHandle,
      context,
      config: makeConfig(listConfig),
      inputData: undefined,
      strategy: deleteWriteStrategy('Post', listConfig, makeConfig(listConfig), context, {
        id: '1',
      }),
    })

    expect(result).toEqual(existing)
    // Delete runs only validate/field-validate — NO resolveInput.
    expect(events).toEqual([
      'db:first',
      'list:validate',
      'field:validate',
      'field:beforeOperation',
      'list:beforeOperation',
      'db:delete',
      'list:afterOperation',
      'field:afterOperation',
    ])
    expect(events).not.toContain('list:resolveInput')
    expect(events).not.toContain('field:resolveInput')
    expect(post.delete).toHaveBeenCalledTimes(1)
  })
})

describe('Write Pipeline — short-circuit to null (silent failure)', () => {
  it('create: access denied short-circuits to null before DB and before beforeOperation', async () => {
    const { ormHandle, post } = makeFakePrisma()
    const listConfig = makeListConfig({ operationAccess: { create: () => false } })
    const context = makeContext()

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      ormHandle,
      context,
      config: makeConfig(listConfig),
      inputData: { title: 'hi' },
      strategy: createWriteStrategy('Post', listConfig, context),
    })

    expect(result).toBeNull()
    expect(post.create).not.toHaveBeenCalled()
    expect(events).not.toContain('list:beforeOperation')
    expect(events).not.toContain('list:resolveInput')
  })

  // #1009: a `create` rule returning a filter reads as though it scopes the
  // create, but create has no existing row to re-check that filter against
  // (unlike update/delete, which do). Before this fix the only test was
  // `=== false`, so a filter fell through and was silently treated as allow.
  it('create: access control returning a filter throws InvalidCreateAccessResultError, before DB and before beforeOperation', async () => {
    const { ormHandle, post } = makeFakePrisma()
    const listConfig = makeListConfig({
      operationAccess: { create: () => ({ authorId: 'someone' }) },
    })
    const context = makeContext()

    await expect(
      runWritePipeline({
        listName: 'Post',
        listConfig,
        ormHandle,
        context,
        config: makeConfig(listConfig),
        inputData: { title: 'hi' },
        strategy: createWriteStrategy('Post', listConfig, context),
      }),
    ).rejects.toThrow(InvalidCreateAccessResultError)

    expect(post.create).not.toHaveBeenCalled()
    expect(events).not.toContain('list:beforeOperation')
    expect(events).not.toContain('list:resolveInput')
  })

  it('update: missing target short-circuits to null before access, hooks, and DB', async () => {
    const { ormHandle, post } = makeFakePrisma({ existing: null })
    const listConfig = makeListConfig()
    const context = makeContext()

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      ormHandle,
      context,
      config: makeConfig(listConfig),
      inputData: { title: 'new' },
      strategy: updateWriteStrategy('Post', listConfig, makeConfig(listConfig), context, {
        id: 'missing',
      }),
    })

    expect(result).toBeNull()
    expect(post.update).not.toHaveBeenCalled()
    expect(events).toEqual(['db:first'])
  })

  it('update: filter non-match short-circuits to null before DB and beforeOperation', async () => {
    const existing = { id: '1', title: 'old' }
    // filterMatch null => the access filter does not match the target row.
    const { ormHandle, post } = makeFakePrisma({ existing, filterMatch: null })
    const listConfig = makeListConfig({
      operationAccess: { update: () => ({ authorId: 'someone-else' }) },
    })
    const context = makeContext()

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      ormHandle,
      context,
      config: makeConfig(listConfig),
      inputData: { title: 'new' },
      strategy: updateWriteStrategy('Post', listConfig, makeConfig(listConfig), context, {
        id: '1',
      }),
    })

    expect(result).toBeNull()
    expect(post.update).not.toHaveBeenCalled()
    // Resolution ran findUnique then findFirst (the filter re-check), then bailed.
    expect(events).toEqual(['db:first', 'db:first'])
  })

  it('update: a filter that matches the target proceeds through the full pipeline', async () => {
    const existing = { id: '1', title: 'old' }
    const { ormHandle, post } = makeFakePrisma({
      existing,
      filterMatch: existing,
      updated: { id: '1', title: 'new' },
    })
    const listConfig = makeListConfig({
      operationAccess: { update: () => ({ authorId: 'u1' }) },
    })
    const context = makeContext()

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      ormHandle,
      context,
      config: makeConfig(listConfig),
      inputData: { title: 'new' },
      strategy: updateWriteStrategy('Post', listConfig, makeConfig(listConfig), context, {
        id: '1',
      }),
    })

    expect(result).toEqual({ id: '1', title: 'new' })
    // The target read, then the filter re-check that gates the hooks.
    expect(post.first).toHaveBeenCalledTimes(2)
    expect(post.update).toHaveBeenCalledTimes(1)
    // …and the update itself runs under both predicates, not the identity
    // alone: two `where` calls per read plus two for the write.
    expect(post.where).toHaveBeenCalledTimes(5)
  })

  it('delete: access denied short-circuits to null before DB', async () => {
    const existing = { id: '1', title: 'x' }
    const { ormHandle, post } = makeFakePrisma({ existing })
    const listConfig = makeListConfig({ operationAccess: { delete: () => false } })
    const context = makeContext()

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      ormHandle,
      context,
      config: makeConfig(listConfig),
      inputData: undefined,
      strategy: deleteWriteStrategy('Post', listConfig, makeConfig(listConfig), context, {
        id: '1',
      }),
    })

    expect(result).toBeNull()
    expect(post.delete).not.toHaveBeenCalled()
    expect(events).not.toContain('list:beforeOperation')
  })
})

describe('Write Pipeline — validation throws (NOT silent)', () => {
  it('create: a missing required field throws ValidationError and never reaches the DB', async () => {
    const { ormHandle, post } = makeFakePrisma()
    const listConfig = makeListConfig()
    const context = makeContext()

    await expect(
      runWritePipeline({
        listName: 'Post',
        listConfig,
        ormHandle,
        context,
        config: makeConfig(listConfig),
        inputData: {}, // title is required but absent
        strategy: createWriteStrategy('Post', listConfig, context),
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(post.create).not.toHaveBeenCalled()
    // Built-in field rules run AFTER the validate hooks and BEFORE beforeOperation.
    expect(events).toContain('list:validate')
    expect(events).not.toContain('list:beforeOperation')
  })
})

describe('Write Pipeline — sudo mode', () => {
  it('create: sudo skips operation-level access checks', async () => {
    const accessSpy = vi.fn(() => false)
    const { ormHandle, post } = makeFakePrisma({ created: { id: '1', title: 'hi' } })
    const listConfig = makeListConfig({ operationAccess: { create: accessSpy } })
    const context = makeContext({ isSudo: true })

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      ormHandle,
      context,
      config: makeConfig(listConfig),
      inputData: { title: 'hi' },
      strategy: createWriteStrategy('Post', listConfig, context),
    })

    // Access denied would normally null this out; sudo bypasses the check.
    expect(result).toEqual({ id: '1', title: 'hi' })
    expect(accessSpy).not.toHaveBeenCalled()
    expect(post.create).toHaveBeenCalledTimes(1)
  })

  it('update: sudo skips access and skips the filter re-check', async () => {
    const accessSpy = vi.fn(() => ({ authorId: 'someone-else' }))
    const existing = { id: '1', title: 'old' }
    const { ormHandle, post } = makeFakePrisma({
      existing,
      filterMatch: null,
      updated: { id: '1', title: 'new' },
    })
    const listConfig = makeListConfig({ operationAccess: { update: accessSpy } })
    const context = makeContext({ isSudo: true })

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      ormHandle,
      context,
      config: makeConfig(listConfig),
      inputData: { title: 'new' },
      strategy: updateWriteStrategy('Post', listConfig, makeConfig(listConfig), context, {
        id: '1',
      }),
    })

    expect(result).toEqual({ id: '1', title: 'new' })
    expect(accessSpy).not.toHaveBeenCalled()
    // The target read happens; the filter re-check does not.
    expect(post.first).toHaveBeenCalledTimes(1)
    expect(post.update).toHaveBeenCalledTimes(1)
  })

  it('create: sudo skips writable-field filtering (denied field still written)', async () => {
    // A field whose create access is false would normally be stripped by
    // filterWritableFields; under sudo it must survive into the DB payload.
    const captured: Record<string, unknown>[] = []
    const post = rc8Collection()
    post.create.mockImplementation(async (data: Record<string, unknown>) => {
      captured.push(data)
      return { id: '1', ...data }
    })
    const ormHandle = { Post: post } as unknown as OrmClient

    const listConfig = {
      fields: {
        title: { type: 'text' },
        locked: { type: 'text', access: { create: async () => false } },
      },
      access: { operation: { query: () => true, create: () => true } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as unknown as ListConfig<any>
    const context = makeContext({ isSudo: true })

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      ormHandle,
      context,
      config: makeConfig(listConfig),
      inputData: { title: 'hi', locked: 'secret' },
      strategy: createWriteStrategy('Post', listConfig, context),
    })

    expect(captured[0]).toEqual({ title: 'hi', locked: 'secret' })
    expect(result).toMatchObject({ locked: 'secret' })
  })
})

describe('Write Pipeline — afterOperation originalItem', () => {
  it('create: afterOperation receives the persisted row and undefined originalItem', async () => {
    const persisted = { id: '1', title: 'hi' }
    const { ormHandle } = makeFakePrisma({ created: persisted })
    const afterOp = vi.fn()
    const listConfig = {
      fields: { title: { type: 'text' } },
      access: { operation: { query: () => true, create: () => true } },
      hooks: { afterOperation: afterOp },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as unknown as ListConfig<any>
    const context = makeContext()

    await runWritePipeline({
      listName: 'Post',
      listConfig,
      ormHandle,
      context,
      config: makeConfig(listConfig),
      inputData: { title: 'hi' },
      strategy: createWriteStrategy('Post', listConfig, context),
    })

    expect(afterOp).toHaveBeenCalledTimes(1)
    const arg = afterOp.mock.calls[0][0]
    expect(arg.operation).toBe('create')
    expect(arg.item).toEqual(persisted)
    expect('originalItem' in arg).toBe(false)
  })

  it('update: afterOperation receives the persisted row and the original row as originalItem', async () => {
    const existing = { id: '1', title: 'old' }
    const updated = { id: '1', title: 'new' }
    const { ormHandle } = makeFakePrisma({ existing, updated })
    const afterOp = vi.fn()
    const listConfig = {
      fields: { title: { type: 'text' } },
      access: { operation: { query: () => true, update: () => true } },
      hooks: { afterOperation: afterOp },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as unknown as ListConfig<any>
    const context = makeContext()

    await runWritePipeline({
      listName: 'Post',
      listConfig,
      ormHandle,
      context,
      config: makeConfig(listConfig),
      inputData: { title: 'new' },
      strategy: updateWriteStrategy('Post', listConfig, makeConfig(listConfig), context, {
        id: '1',
      }),
    })

    const arg = afterOp.mock.calls[0][0]
    expect(arg.operation).toBe('update')
    expect(arg.item).toEqual(updated)
    expect(arg.originalItem).toEqual(existing)
  })

  it('delete: afterOperation receives the original row as originalItem', async () => {
    const existing = { id: '1', title: 'doomed' }
    const { ormHandle } = makeFakePrisma({ existing, deleted: existing })
    const afterOp = vi.fn()
    const listConfig = {
      fields: { title: { type: 'text' } },
      access: { operation: { query: () => true, delete: () => true } },
      hooks: { afterOperation: afterOp },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as unknown as ListConfig<any>
    const context = makeContext()

    await runWritePipeline({
      listName: 'Post',
      listConfig,
      ormHandle,
      context,
      config: makeConfig(listConfig),
      inputData: undefined,
      strategy: deleteWriteStrategy('Post', listConfig, makeConfig(listConfig), context, {
        id: '1',
      }),
    })

    const arg = afterOp.mock.calls[0][0]
    expect(arg.operation).toBe('delete')
    expect(arg.originalItem).toEqual(existing)
  })
})
