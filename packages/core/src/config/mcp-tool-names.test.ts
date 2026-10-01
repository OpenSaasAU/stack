import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { config, list } from './index.js'
import { text } from '../fields/index.js'

const tool = (name: string) => ({
  name,
  description: 'x',
  inputSchema: z.object({}),
  handler: async () => ({}),
})

const withTools = (names: string[]) =>
  config({
    db: { provider: 'postgresql' },
    lists: {
      Post: list({
        fields: { title: text() },
        mcp: { enabled: true, customTools: names.map(tool) },
      }),
    },
  })

describe('MCP tool name uniqueness', () => {
  it('refuses a custom tool named like a CRUD tool', () => {
    expect(() => withTools(['list_post_query'])).toThrow(/"list_post_query".*built-in query/)
  })

  it('refuses two custom tools with the same name', () => {
    expect(() => withTools(['search', 'search'])).toThrow(/"search"/)
  })

  it('accepts distinct names', () => {
    expect(() => withTools(['search', 'export'])).not.toThrow()
  })
})
