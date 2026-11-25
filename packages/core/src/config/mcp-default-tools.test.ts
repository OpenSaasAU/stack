import { describe, expect, test } from 'vitest'
import { config } from './index.js'
import type { McpConfig, McpDefaultToolsConfig, OpenSaasConfig, Plugin } from './types.js'
import { text } from '../fields/index.js'

const withWriteKey: Record<
  'create' | 'update' | 'delete',
  (value: boolean) => McpDefaultToolsConfig
> = {
  create: (value): McpDefaultToolsConfig => ({
    read: true,
    // @ts-expect-error -- a removed key
    create: value,
  }),
  update: (value): McpDefaultToolsConfig => ({
    read: true,
    // @ts-expect-error -- a removed key
    update: value,
  }),
  delete: (value): McpDefaultToolsConfig => ({
    read: true,
    // @ts-expect-error -- a removed key
    delete: value,
  }),
}

function withMcp(mcp: McpConfig, plugins?: Plugin[]): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    mcp,
    plugins,
    lists: { Post: { fields: { title: text() } } },
  }
}

function withDefaultTools(defaultTools: McpDefaultToolsConfig, plugins?: Plugin[]): OpenSaasConfig {
  return withMcp({ enabled: true, defaultTools }, plugins)
}

describe('mcp.defaultTools', () => {
  test.each(['create', 'update', 'delete'] as const)(
    'refuses %s, even set to false, naming the per-list key',
    (key) => {
      expect(() => config(withDefaultTools(withWriteKey[key](false)))).toThrow(
        `mcp.defaultTools.${key} is not supported`,
      )
      expect(() => config(withDefaultTools(withWriteKey[key](true)))).toThrow(
        `lists.<List>.mcp.tools.${key}: true`,
      )
    },
  )

  test('refuses a write key on a config with plugins too', () => {
    const noop: Plugin = { name: 'noop', init: async () => {} }
    expect(() => config(withDefaultTools(withWriteKey.delete(false), [noop]))).toThrow(
      'mcp.defaultTools.delete is not supported',
    )
  })

  test('accepts the read key alone', () => {
    expect(() => config(withDefaultTools({ read: false }))).not.toThrow()
  })

  test('accepts a null defaultTools from an untyped config', () => {
    expect(() =>
      config(
        withMcp({
          enabled: true,
          // @ts-expect-error -- null reaches here from a JavaScript or JSON-derived config
          defaultTools: null,
        }),
      ),
    ).not.toThrow()
  })
})
