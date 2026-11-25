import { describe, expect, test } from 'vitest'
import { ValidationError } from '../hooks/index.js'
import { executeResolveInput } from '../hooks/index.js'
import { executePlugins } from './plugin-engine.js'
import type { OpenSaasConfig } from './types.js'

describe('a plugin-extended list resolveInput chain', () => {
  test('an intermediate undefined result is rejected, not papered over by a later hook', async () => {
    const config = {
      db: { provider: 'postgresql' },
      lists: {
        Doc: {
          fields: {},
          hooks: { resolveInput: async () => undefined },
        },
      },
      plugins: [
        {
          name: 'p',
          version: '0.0.0',
          init: async (ctx: { extendList: (k: string, e: object) => void }) => {
            ctx.extendList('Doc', {
              hooks: {
                resolveInput: async ({ resolvedData }: { resolvedData: object }) => ({
                  ...resolvedData,
                  x: 1,
                }),
              },
            })
          },
        },
      ],
    } as unknown as OpenSaasConfig
    const resolved = await executePlugins(config)
    const hooks = resolved.lists.Doc?.hooks
    await expect(
      executeResolveInput(hooks, {
        listKey: 'Doc',
        operation: 'create',
        inputData: { title: 'a' },
        resolvedData: { title: 'a' },
        item: undefined,
        context: {} as never,
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})
