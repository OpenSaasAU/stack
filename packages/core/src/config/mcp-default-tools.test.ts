import { describe, expect, test } from 'vitest'
import { config } from './index.js'
import type { McpConfig, OpenSaasConfig, Plugin } from './types.js'
import { text } from '../fields/index.js'

function withDefaultTools(json: string, plugins?: Plugin[]): OpenSaasConfig {
  const mcp: McpConfig = JSON.parse(`{"enabled":true,"defaultTools":${json}}`)
  return {
    db: { provider: 'postgresql' },
    mcp,
    plugins,
    lists: { Post: { fields: { title: text() } } },
  }
}

describe('mcp.defaultTools', () => {
  test.each(['create', 'update', 'delete'])(
    'refuses %s, even set to false, naming the per-list key',
    (key) => {
      expect(() => config(withDefaultTools(`{"${key}":false}`))).toThrow(
        `mcp.defaultTools.${key} is not supported`,
      )
      expect(() => config(withDefaultTools(`{"${key}":true}`))).toThrow(
        `lists.<List>.mcp.tools.${key}: true`,
      )
    },
  )

  test('refuses a write key on a config with plugins too', () => {
    const noop: Plugin = { name: 'noop', init: async () => {} }
    expect(() => config(withDefaultTools('{"delete":false}', [noop]))).toThrow(
      'mcp.defaultTools.delete is not supported',
    )
  })

  test('accepts the read key alone', () => {
    expect(() => config(withDefaultTools('{"read":false}'))).not.toThrow()
  })
})
