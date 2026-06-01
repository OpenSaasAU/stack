import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  runWritePipeline,
  createWriteStrategy,
  updateWriteStrategy,
  deleteWriteStrategy,
} from '../src/context/write-pipeline.js'
import { ValidationError } from '../src/hooks/index.js'
import { text } from '../src/fields/index.js'
import type { OpenSaasConfig, ListConfig } from '../src/config/types.js'
import type { AccessContext, PrismaClientLike } from '../src/access/types.js'

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
 * Build a fake Prisma model whose methods log their calls. The pipeline
 * resolves the model dynamically via getDbKey('Post') -> 'post'.
 */
function makeFakePrisma(overrides?: {
  existing?: Record<string, unknown> | null
  filterMatch?: Record<string, unknown> | null
  created?: Record<string, unknown>
  updated?: Record<string, unknown>
  deleted?: Record<string, unknown>
  count?: number
}) {
  const created = overrides?.created ?? { id: '1', title: 'created' }
  const updated = overrides?.updated ?? { id: '1', title: 'updated' }
  const deleted = overrides?.deleted ?? { id: '1', title: 'deleted' }

  const post = {
    findUnique: vi.fn(async () => {
      events.push('db:findUnique')
      return overrides?.existing ?? null
    }),
    findFirst: vi.fn(async () => {
      events.push('db:findFirst')
      return overrides?.filterMatch ?? null
    }),
    count: vi.fn(async () => {
      events.push('db:count')
      return overrides?.count ?? 0
    }),
    create: vi.fn(async () => {
      events.push('db:create')
      return created
    }),
    update: vi.fn(async () => {
      events.push('db:update')
      return updated
    }),
    delete: vi.fn(async () => {
      events.push('db:delete')
      return deleted
    }),
  }

  return { prisma: { post } as unknown as PrismaClientLike, post }
}

/**
 * Build a minimal AccessContext for the pipeline.
 */
function makeContext(opts?: { isSudo?: boolean }): AccessContext {
  return {
    session: { userId: 'u1' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    storage: {} as any,
    plugins: {},
    _isSudo: opts?.isSudo ?? false,
    _resolveOutputCounter: { depth: 0 },
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
    const { prisma, post } = makeFakePrisma({ created: { id: '1', title: 'hi' } })
    const listConfig = makeListConfig()
    const context = makeContext()

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      prisma,
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
    const { prisma, post } = makeFakePrisma({ existing, updated: { id: '1', title: 'new' } })
    const listConfig = makeListConfig()
    const context = makeContext()

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      prisma,
      context,
      config: makeConfig(listConfig),
      inputData: { title: 'new' },
      strategy: updateWriteStrategy(listConfig, context, { id: '1' }),
    })

    expect(result).toEqual({ id: '1', title: 'new' })
    expect(events).toEqual([
      'db:findUnique',
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
    const { prisma, post } = makeFakePrisma({ existing, deleted: existing })
    const listConfig = makeListConfig()
    const context = makeContext()

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      prisma,
      context,
      config: makeConfig(listConfig),
      inputData: undefined,
      strategy: deleteWriteStrategy('Post', listConfig, context, { id: '1' }),
    })

    expect(result).toEqual(existing)
    // Delete runs only validate/field-validate — NO resolveInput.
    expect(events).toEqual([
      'db:findUnique',
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
    const { prisma, post } = makeFakePrisma()
    const listConfig = makeListConfig({ operationAccess: { create: () => false } })
    const context = makeContext()

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      prisma,
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

  it('update: missing target short-circuits to null before access, hooks, and DB', async () => {
    const { prisma, post } = makeFakePrisma({ existing: null })
    const listConfig = makeListConfig()
    const context = makeContext()

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      prisma,
      context,
      config: makeConfig(listConfig),
      inputData: { title: 'new' },
      strategy: updateWriteStrategy(listConfig, context, { id: 'missing' }),
    })

    expect(result).toBeNull()
    expect(post.update).not.toHaveBeenCalled()
    expect(events).toEqual(['db:findUnique'])
  })

  it('update: filter non-match short-circuits to null before DB and beforeOperation', async () => {
    const existing = { id: '1', title: 'old' }
    // filterMatch null => the access filter does not match the target row.
    const { prisma, post } = makeFakePrisma({ existing, filterMatch: null })
    const listConfig = makeListConfig({
      operationAccess: { update: () => ({ authorId: 'someone-else' }) },
    })
    const context = makeContext()

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      prisma,
      context,
      config: makeConfig(listConfig),
      inputData: { title: 'new' },
      strategy: updateWriteStrategy(listConfig, context, { id: '1' }),
    })

    expect(result).toBeNull()
    expect(post.update).not.toHaveBeenCalled()
    // Resolution ran findUnique then findFirst (the filter re-check), then bailed.
    expect(events).toEqual(['db:findUnique', 'db:findFirst'])
  })

  it('update: a filter that matches the target proceeds through the full pipeline', async () => {
    const existing = { id: '1', title: 'old' }
    const { prisma, post } = makeFakePrisma({
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
      prisma,
      context,
      config: makeConfig(listConfig),
      inputData: { title: 'new' },
      strategy: updateWriteStrategy(listConfig, context, { id: '1' }),
    })

    expect(result).toEqual({ id: '1', title: 'new' })
    expect(post.findFirst).toHaveBeenCalledTimes(1)
    expect(post.update).toHaveBeenCalledTimes(1)
  })

  it('delete: access denied short-circuits to null before DB', async () => {
    const existing = { id: '1', title: 'x' }
    const { prisma, post } = makeFakePrisma({ existing })
    const listConfig = makeListConfig({ operationAccess: { delete: () => false } })
    const context = makeContext()

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      prisma,
      context,
      config: makeConfig(listConfig),
      inputData: undefined,
      strategy: deleteWriteStrategy('Post', listConfig, context, { id: '1' }),
    })

    expect(result).toBeNull()
    expect(post.delete).not.toHaveBeenCalled()
    expect(events).not.toContain('list:beforeOperation')
  })
})

describe('Write Pipeline — validation throws (NOT silent)', () => {
  it('create: a missing required field throws ValidationError and never reaches the DB', async () => {
    const { prisma, post } = makeFakePrisma()
    const listConfig = makeListConfig()
    const context = makeContext()

    await expect(
      runWritePipeline({
        listName: 'Post',
        listConfig,
        prisma,
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
    const { prisma, post } = makeFakePrisma({ created: { id: '1', title: 'hi' } })
    const listConfig = makeListConfig({ operationAccess: { create: accessSpy } })
    const context = makeContext({ isSudo: true })

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      prisma,
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
    const { prisma, post } = makeFakePrisma({
      existing,
      filterMatch: null,
      updated: { id: '1', title: 'new' },
    })
    const listConfig = makeListConfig({ operationAccess: { update: accessSpy } })
    const context = makeContext({ isSudo: true })

    const result = await runWritePipeline({
      listName: 'Post',
      listConfig,
      prisma,
      context,
      config: makeConfig(listConfig),
      inputData: { title: 'new' },
      strategy: updateWriteStrategy(listConfig, context, { id: '1' }),
    })

    expect(result).toEqual({ id: '1', title: 'new' })
    expect(accessSpy).not.toHaveBeenCalled()
    expect(post.findFirst).not.toHaveBeenCalled() // no filter re-check under sudo
    expect(post.update).toHaveBeenCalledTimes(1)
  })

  it('create: sudo skips writable-field filtering (denied field still written)', async () => {
    // A field whose create access is false would normally be stripped by
    // filterWritableFields; under sudo it must survive into the DB payload.
    const captured: Record<string, unknown>[] = []
    const post = {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(async () => 0),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        captured.push(args.data)
        return { id: '1', ...args.data }
      }),
      update: vi.fn(),
      delete: vi.fn(),
    }
    const prisma = { post } as unknown as PrismaClientLike

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
      prisma,
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
    const { prisma } = makeFakePrisma({ created: persisted })
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
      prisma,
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
    const { prisma } = makeFakePrisma({ existing, updated })
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
      prisma,
      context,
      config: makeConfig(listConfig),
      inputData: { title: 'new' },
      strategy: updateWriteStrategy(listConfig, context, { id: '1' }),
    })

    const arg = afterOp.mock.calls[0][0]
    expect(arg.operation).toBe('update')
    expect(arg.item).toEqual(updated)
    expect(arg.originalItem).toEqual(existing)
  })

  it('delete: afterOperation receives the original row as originalItem', async () => {
    const existing = { id: '1', title: 'doomed' }
    const { prisma } = makeFakePrisma({ existing, deleted: existing })
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
      prisma,
      context,
      config: makeConfig(listConfig),
      inputData: undefined,
      strategy: deleteWriteStrategy('Post', listConfig, context, { id: '1' }),
    })

    const arg = afterOp.mock.calls[0][0]
    expect(arg.operation).toBe('delete')
    expect(arg.originalItem).toEqual(existing)
  })
})
