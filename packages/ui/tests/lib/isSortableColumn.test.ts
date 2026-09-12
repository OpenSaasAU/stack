import { describe, it, expect } from 'vitest'
import { isSortableColumn } from '../../src/lib/utils.js'
import type { SerializableFieldConfig } from '../../src/lib/serializeFieldConfig.js'

/**
 * Which headers offer a sort affordance.
 *
 * `orderBy` takes the list's own scalar columns, so a relationship of either
 * cardinality — a to-many count column included — is refused by the server
 * (ADR-0055). A header that looked clickable and then failed the read is the
 * regression this pins.
 */

function field(config: SerializableFieldConfig): SerializableFieldConfig {
  return config
}

describe('isSortableColumn', () => {
  it('excludes a relationship of either cardinality', () => {
    expect(isSortableColumn(field({ type: 'relationship', ref: 'User.posts' }))).toBe(false)
    expect(isSortableColumn(field({ type: 'relationship', ref: 'User.posts', many: true }))).toBe(
      false,
    )
  })

  it('excludes a virtual field, which has no column to order by', () => {
    expect(isSortableColumn(field({ type: 'text', virtual: true }))).toBe(false)
  })

  it('includes the list’s own scalar columns', () => {
    expect(isSortableColumn(field({ type: 'text' }))).toBe(true)
    expect(isSortableColumn(field({ type: 'integer' }))).toBe(true)
    expect(isSortableColumn(field({ type: 'timestamp' }))).toBe(true)
  })

  it('treats an unknown column as sortable', () => {
    expect(isSortableColumn(undefined)).toBe(true)
  })
})
