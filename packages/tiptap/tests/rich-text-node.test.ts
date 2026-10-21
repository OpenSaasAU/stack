// @vitest-environment node
import { describe, expect, it } from 'vitest'

describe('server path without a DOM', () => {
  it('loads richText and validates', async () => {
    expect(typeof document).toBe('undefined')
    const { richText } = await import('../src/fields/richText.js')
    const schema = richText({ features: { link: {} } }).getZodSchema!('content', 'create')
    expect(schema.safeParse({ type: 'doc', content: [{ type: 'paragraph' }] }).success).toBe(true)
  })
})
