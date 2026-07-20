import { describe, it, expect } from 'vitest'
import type { AccessContext } from '@opensaas/stack-core'
import { list } from '@opensaas/stack-core'
import { text, json, integer, password, virtual } from '@opensaas/stack-core/fields'
import { resolveEditableColumns } from '../../src/components/RelationshipTable.js'
import type { RelationshipTableSection } from '../../src/lib/deriveItemView.js'

// A minimal access-scoped context: resolveEditableColumns only forwards it to
// the related list's own access functions (which ignore it here).
function makeContext(): AccessContext<unknown> {
  const context = {
    db: {},
    session: null,
    storage: {},
    plugins: {},
    _isSudo: false,
    _resolveOutputCounter: { depth: 0 },
  }
  return context as unknown as AccessContext<unknown>
}

function section(columns: string[]): RelationshipTableSection {
  return {
    fieldName: 'items',
    ref: 'Item.parent',
    relatedListKey: 'Item',
    backReferenceField: 'parent',
    columns,
    take: 10,
    sumColumns: [],
    removeAction: 'disconnect',
    disconnectable: true,
  }
}

describe('resolveEditableColumns — json exclusion (#761)', () => {
  it('excludes json columns from inline-editable columns', async () => {
    // The related list allows update at the operation level, and every field's
    // update field-access is allow-by-default — so only the field TYPE gates it.
    const relatedListConfig = list({
      access: { operation: { update: () => true } },
      fields: {
        title: text(),
        metadata: json(),
      },
    })

    const editable = await resolveEditableColumns(
      section(['title', 'metadata']),
      relatedListConfig,
      makeContext(),
    )

    // The scalar text column is editable; the json column is not (it needs a
    // proper structured editor, and its fresh-reference draft would otherwise
    // waste a round-trip on the reference-equality no-op guard).
    expect(editable).toEqual(['title'])
    expect(editable).not.toContain('metadata')
  })

  it('keeps the existing scalar / relationship / virtual / password / system exclusions intact', async () => {
    const relatedListConfig = list({
      access: { operation: { update: () => true } },
      fields: {
        title: text(),
        count: integer(),
        secret: password(),
        computed: virtual({ type: 'string', hooks: { resolveOutput: () => 'x' } }),
        payload: json(),
      },
    })

    const editable = await resolveEditableColumns(
      section(['id', 'title', 'count', 'secret', 'computed', 'payload', 'createdAt']),
      relatedListConfig,
      makeContext(),
    )

    // Only the writable scalars remain; json joins password/virtual/system in
    // the excluded set.
    expect(editable).toEqual(['title', 'count'])
  })
})
