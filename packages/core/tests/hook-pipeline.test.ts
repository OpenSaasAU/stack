import { describe, it, expect, beforeEach } from 'vitest'
import { hookPipeline } from '../src/context/hook-pipeline.js'
import { ValidationError } from '../src/hooks/index.js'
import { text } from '../src/fields/index.js'
import type { ListConfig } from '../src/config/types.js'
import type { AccessContext } from '../src/access/types.js'

/**
 * Unit tests for the Hook Pipeline — the module that owns the transform+validate
 * span: list `resolveInput` → field `resolveInput` → list `validate` → field
 * `validate` → built-in field rules (`validateFieldRules`). These drive
 * `hookPipeline.run` directly (spy hooks + a list config), so the span order and
 * the resolvedData threading become the test surface.
 *
 * Asserted here:
 *   - the four hook phases + field rules run in the documented order;
 *   - a list/field `validate` hook calling `addValidationError` THROWS
 *     ValidationError (validation is never silent);
 *   - a built-in field rule failure (isRequired) THROWS ValidationError;
 *   - on success the pipeline returns the transformed `resolvedData`.
 */

// Shared ordered log of phase events for order assertions.
let events: string[]

/**
 * Build a minimal AccessContext for the pipeline.
 */
function makeContext(): AccessContext {
  return {
    session: { userId: 'u1' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ormHandle: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    storage: {} as any,
    plugins: {},
    _isSudo: false,
    _resolveOutputChain: [],
  }
}

/**
 * A list config with a spy on every span hook, recording its phase into
 * `events`. `title` is a required field so we can exercise built-in field rules.
 */
function makeListConfig(opts?: {
  listValidateError?: string
  fieldValidateError?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): ListConfig<any> {
  return {
    fields: {
      title: text({
        validation: { isRequired: true },
        hooks: {
          resolveInput: async ({ resolvedData, fieldKey }) => {
            events.push('field:resolveInput')
            // Uppercase the value so we can assert resolvedData threads through.
            const value = resolvedData[fieldKey]
            return typeof value === 'string' ? value.toUpperCase() : value
          },
          validate: async ({ addValidationError }) => {
            events.push('field:validate')
            if (opts?.fieldValidateError) addValidationError(opts.fieldValidateError)
          },
        },
      }),
    },
    access: {
      operation: { query: () => true, create: () => true, update: () => true },
    },
    hooks: {
      resolveInput: async ({ resolvedData }) => {
        events.push('list:resolveInput')
        return resolvedData
      },
      validate: async ({ addValidationError }) => {
        events.push('list:validate')
        if (opts?.listValidateError) addValidationError(opts.listValidateError)
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as ListConfig<any>
}

beforeEach(() => {
  events = []
})

describe('Hook Pipeline — span order', () => {
  it('runs create span phases in order: list resolveInput → field resolveInput → list validate → field validate → field rules', async () => {
    const listConfig = makeListConfig()
    const context = makeContext()

    const { resolvedData } = await hookPipeline.run({
      operation: 'create',
      listName: 'Post',
      listConfig,
      inputData: { title: 'hi' },
      item: undefined,
      context,
    })

    expect(events).toEqual([
      'list:resolveInput',
      'field:resolveInput',
      'list:validate',
      'field:validate',
    ])
    expect(events.indexOf('list:resolveInput')).toBeLessThan(events.indexOf('field:resolveInput'))
    expect(events.indexOf('field:resolveInput')).toBeLessThan(events.indexOf('list:validate'))
    expect(events.indexOf('list:validate')).toBeLessThan(events.indexOf('field:validate'))
    // resolvedData threads through the field resolveInput transform.
    expect(resolvedData).toEqual({ title: 'HI' })
  })

  it('runs update span phases in order and passes the existing item through', async () => {
    const listConfig = makeListConfig()
    const context = makeContext()
    const existing = { id: '1', title: 'old' }

    const { resolvedData } = await hookPipeline.run({
      operation: 'update',
      listName: 'Post',
      listConfig,
      inputData: { title: 'new' },
      item: existing,
      context,
    })

    expect(events).toEqual([
      'list:resolveInput',
      'field:resolveInput',
      'list:validate',
      'field:validate',
    ])
    expect(resolvedData).toEqual({ title: 'NEW' })
  })
})

describe('Hook Pipeline — validation throws (NOT silent)', () => {
  it('throws ValidationError when a list validate hook calls addValidationError', async () => {
    const listConfig = makeListConfig({ listValidateError: 'list says no' })
    const context = makeContext()

    await expect(
      hookPipeline.run({
        operation: 'create',
        listName: 'Post',
        listConfig,
        inputData: { title: 'hi' },
        item: undefined,
        context,
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    // field:validate and field rules never run after a list validate failure.
    expect(events).not.toContain('field:validate')
  })

  it('throws ValidationError when a field validate hook calls addValidationError', async () => {
    const listConfig = makeListConfig({ fieldValidateError: 'field says no' })
    const context = makeContext()

    await expect(
      hookPipeline.run({
        operation: 'create',
        listName: 'Post',
        listConfig,
        inputData: { title: 'hi' },
        item: undefined,
        context,
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(events).toContain('field:validate')
  })

  it('throws ValidationError when a built-in field rule (isRequired) fails', async () => {
    const listConfig = makeListConfig()
    const context = makeContext()

    await expect(
      hookPipeline.run({
        operation: 'create',
        listName: 'Post',
        listConfig,
        inputData: {}, // title is required but absent
        item: undefined,
        context,
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    // The validate hooks ran before the rules threw.
    expect(events).toContain('list:validate')
    expect(events).toContain('field:validate')
  })
})

describe('Hook Pipeline — resolvedData threading', () => {
  it('returns the transformed resolvedData merged with list-level resolveInput changes', async () => {
    const context = makeContext()
    // List resolveInput injects an extra field; field resolveInput uppercases title.
    const listConfig = {
      fields: {
        title: text({
          hooks: {
            resolveInput: async ({ resolvedData, fieldKey }) => {
              const value = resolvedData[fieldKey]
              return typeof value === 'string' ? value.toUpperCase() : value
            },
          },
        }),
        slug: text(),
      },
      access: { operation: { query: () => true, create: () => true } },
      hooks: {
        resolveInput: async ({ resolvedData }) => ({ ...resolvedData, slug: 'auto-slug' }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as ListConfig<any>

    const { resolvedData } = await hookPipeline.run({
      operation: 'create',
      listName: 'Post',
      listConfig,
      inputData: { title: 'hello' },
      item: undefined,
      context,
    })

    expect(resolvedData).toEqual({ title: 'HELLO', slug: 'auto-slug' })
  })
})
