import { describe, expect, test } from 'vitest'
import { orderByArgument, whereArgument } from './arguments.js'

describe('MCP where and orderBy arguments', () => {
  test('keep a __proto__ key as an own key for the engine to refuse', () => {
    const where = whereArgument(JSON.parse('{"__proto__":{"equals":1}}'), 'Post')
    expect(Object.keys(where)).toEqual(['__proto__'])
    const nested = whereArgument(JSON.parse('{"NOT":{"__proto__":{"equals":1}}}'), 'Post')
    expect(Object.keys(nested)).toEqual(['NOT'])
  })

  test('keep a __proto__ sort column as an own key', () => {
    const [order] = orderByArgument(JSON.parse('{"__proto__":"asc"}'), 'Post')
    expect(Object.keys(order)).toEqual(['__proto__'])
  })
})
