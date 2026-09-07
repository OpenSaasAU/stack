// What survives when a plugin extends a list that already declares hooks of
// its own: every hook kind, both sides, the list's own first.

import { describe, expect, test } from 'vitest'
import { config as defineConfig } from '../index.js'
import type { AccessContext } from '../index.js'
import type { Plugin } from '../extend.js'
import { text } from '../fields/index.js'

const context: AccessContext = {
  session: null,
  ormHandle: {},
  db: {},
  storage: {
    uploadFile: async () => ({ filename: '', filesize: 0, url: '' }),
    uploadImage: async () => ({ id: '', extension: '', width: 0, height: 0, filesize: 0, url: '' }),
    deleteFile: async () => {},
    deleteImage: async () => {},
  },
  plugins: {},
  _isSudo: false,
  _resolveOutputChain: [],
}

/** A plugin that adds one hook of each kind to an existing list. */
function recordingPlugin(calls: string[]): Plugin {
  return {
    name: 'recorder',
    version: '0.0.0',
    init: (pluginContext) => {
      pluginContext.extendList('Article', {
        hooks: {
          resolveInput: async ({ resolvedData }) => {
            calls.push('plugin.resolveInput')
            return resolvedData
          },
          validate: async () => {
            calls.push('plugin.validate')
          },
          beforeOperation: async () => {
            calls.push('plugin.beforeOperation')
          },
          afterOperation: async () => {
            calls.push('plugin.afterOperation')
          },
          beforeTransaction: async () => {
            calls.push('plugin.beforeTransaction')
          },
          afterTransaction: async () => {
            calls.push('plugin.afterTransaction')
          },
        },
      })
    },
  }
}

async function resolveWithBothSides(calls: string[]) {
  const resolved = await defineConfig({
    db: { provider: 'postgresql' },
    plugins: [recordingPlugin(calls)],
    lists: {
      Article: {
        fields: { title: text() },
        hooks: {
          resolveInput: async ({ resolvedData }) => {
            calls.push('list.resolveInput')
            return resolvedData
          },
          validate: async () => {
            calls.push('list.validate')
          },
          beforeOperation: async () => {
            calls.push('list.beforeOperation')
          },
          afterOperation: async () => {
            calls.push('list.afterOperation')
          },
          beforeTransaction: async () => {
            calls.push('list.beforeTransaction')
          },
          afterTransaction: async () => {
            calls.push('list.afterTransaction')
          },
        },
      },
    },
  })
  const hooks = resolved.lists.Article.hooks
  if (hooks === undefined) throw new Error('the resolved list carries no hooks')
  return hooks
}

describe('a plugin extending a list that declares its own hooks', () => {
  test('keeps both sides of every hook kind, the list’s own first', async () => {
    const calls: string[] = []
    const hooks = await resolveWithBothSides(calls)
    const args = {
      listKey: 'Article',
      operation: 'create',
      inputData: { title: 'a' },
      resolvedData: { title: 'a' },
      item: undefined,
      context,
      addValidationError: () => {},
    } as const

    await hooks.resolveInput?.(args)
    await hooks.validate?.(args)
    await hooks.beforeOperation?.(args)
    await hooks.afterOperation?.({ ...args, item: { id: 'a1' } })
    await hooks.beforeTransaction?.(args)
    await hooks.afterTransaction?.({ ...args, status: 'committed', item: { id: 'a1' } })

    expect(calls).toEqual([
      'list.resolveInput',
      'plugin.resolveInput',
      'list.validate',
      'plugin.validate',
      'list.beforeOperation',
      'plugin.beforeOperation',
      'list.afterOperation',
      'plugin.afterOperation',
      'list.beforeTransaction',
      'plugin.beforeTransaction',
      'list.afterTransaction',
      'plugin.afterTransaction',
    ])
  })

  test('carries the transaction-boundary hooks a plugin adds to a list with hooks of its own', async () => {
    const calls: string[] = []
    const hooks = await resolveWithBothSides(calls)

    expect(typeof hooks.beforeTransaction).toBe('function')
    expect(typeof hooks.afterTransaction).toBe('function')
    expect(typeof hooks.validate).toBe('function')
  })
})
