import { describe, expect, test } from 'vitest'
import { ValidationError } from '../hooks/index.js'
import { WHERE_MAX_NODES, WHERE_RELATION_MAX_DEPTH } from '../access/depth-limits.js'
import { assertWhereWithinLimits } from './vocabulary.js'

function nested(depth: number): Record<string, unknown> {
  let where: Record<string, unknown> = { title: { equals: 'x' } }
  for (let level = 0; level < depth; level++) where = { posts: { some: where } }
  return where
}

describe('assertWhereWithinLimits', () => {
  test('accepts relation nesting at the cap', () => {
    expect(() => assertWhereWithinLimits(nested(WHERE_RELATION_MAX_DEPTH))).not.toThrow()
  })

  test('refuses relation nesting one past the cap', () => {
    expect(() => assertWhereWithinLimits(nested(WHERE_RELATION_MAX_DEPTH + 1))).toThrow(
      ValidationError,
    )
  })

  test('does not count AND/OR/NOT nesting toward depth', () => {
    let where: Record<string, unknown> = { title: 'x' }
    for (let level = 0; level < 20; level++) where = { NOT: where }
    expect(() => assertWhereWithinLimits(where)).not.toThrow()
  })

  test('accepts exactly the node cap and refuses one more', () => {
    const entries = (count: number): Record<string, unknown> =>
      Object.fromEntries(Array.from({ length: count }, (_, i) => [`f${i}`, 1]))
    expect(() => assertWhereWithinLimits(entries(WHERE_MAX_NODES))).not.toThrow()
    expect(() => assertWhereWithinLimits(entries(WHERE_MAX_NODES + 1))).toThrow(ValidationError)
  })

  test('does not descend into scalar operand values', () => {
    let operand: Record<string, unknown> = { some: 1 }
    for (let level = 0; level < 10; level++) operand = { some: operand }
    expect(() => assertWhereWithinLimits({ data: { equals: operand } })).not.toThrow()
  })

  test('counts relation quantifiers inside logical branches', () => {
    expect(() => assertWhereWithinLimits({ OR: [nested(WHERE_RELATION_MAX_DEPTH + 1)] })).toThrow(
      ValidationError,
    )
  })
})
