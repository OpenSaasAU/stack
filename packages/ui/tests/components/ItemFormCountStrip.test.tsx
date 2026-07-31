import { describe, it, expect } from 'vitest'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { buildDetailsItemData } from '../../src/components/ItemForm.js'
import { prepareItemForm } from '../../src/lib/prepareItemForm.js'
import { transformItemFormData } from '../../src/lib/useItemForm.js'
import { deriveItemViewLayout } from '../../src/lib/deriveItemView.js'

/**
 * Regression coverage for issue #797: the derived item view (issue #734/#752)
 * adds a synthetic `_count` select to the record fetch (for the Relationship
 * table's "Showing N of M" footer) alongside the real fields. Before this fix,
 * that `_count` key rode through `detailsItemData` -> `prepareItemForm` ->
 * `transformItemFormData` and ended up in every update payload, which the
 * server rejected ("it is not a field of this list") — Save silently failed
 * on the edit page for ANY list with a `many: true` relationship rendered as
 * a table (the default item-view display mode).
 *
 * This threads the real fetch -> details-data -> submit-transform pipeline
 * `ItemViewLayoutView` runs (`buildDetailsItemData` -> `prepareItemForm` ->
 * `transformItemFormData`), the same functions the component calls, without
 * needing to render the async Relationship-table server components (not
 * supported by this test environment's React DOM renderer).
 */

interface DelegateStub {
  findMany?: (args?: unknown) => Promise<Array<Record<string, unknown>>>
  findFirst?: (args?: unknown) => Promise<Record<string, unknown> | null>
}

function makeContext(delegates: Record<string, DelegateStub>): AccessContext<unknown> {
  const context = {
    db: delegates,
    session: null,
    storage: {},
    plugins: {},
    _isSudo: false,
    _resolveOutputChain: [],
  }
  // Cast: this is a stub for pipeline tests, not a full Prisma-backed context.
  return context as unknown as AccessContext<unknown>
}

/**
 * A list with a `many: true` relationship in the default (table) item-view
 * display mode — the shape that makes `deriveItemViewLayout` produce a
 * Relationship-table section and routes the edit page through
 * `ItemViewLayoutView`.
 */
function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'sqlite', url: 'file:./test.db' },
    lists: {
      Post: {
        fields: {
          title: { type: 'text' },
          comments: { type: 'relationship', ref: 'Comment.post', many: true },
        },
        access: { operation: { query: () => true, update: () => true } },
      },
      Comment: {
        fields: {
          body: { type: 'text' },
          post: { type: 'relationship', ref: 'Post.comments' },
        },
        access: { operation: { query: () => true } },
      },
    },
  } as unknown as OpenSaasConfig
}

describe('ItemForm derived item-view pipeline (issue #797 regression)', () => {
  it('never lets the synthetic `_count` payload survive fetch -> details data -> submit transform', async () => {
    const config = makeConfig()
    const layout = deriveItemViewLayout(config, 'Post')
    expect(layout.sections).toHaveLength(1) // sanity: the to-many relationship became a table section

    const context = makeContext({})

    // The record `ItemViewLayoutView` fetches: the real fields, the bounded
    // relationship rows, AND the synthetic `_count` the fetch adds for the
    // table footer (built by `buildRelationshipCountSelect`).
    const itemData = {
      id: '1',
      title: 'Hello',
      comments: [{ id: 'c1', body: 'Nice post' }],
      _count: { comments: 5 },
    }

    const detailsItemData = buildDetailsItemData(itemData, layout)
    expect(detailsItemData).not.toHaveProperty('_count')
    expect(detailsItemData).not.toHaveProperty('comments') // section field, not a details field
    expect(detailsItemData).toEqual({ id: '1', title: 'Hello' })

    const detailsListConfig = {
      ...config.lists.Post,
      fields: Object.fromEntries(
        layout.detailsFields.map((fieldName) => [fieldName, config.lists.Post.fields[fieldName]]),
      ),
    }

    const { serializableFields, initialData } = await prepareItemForm(
      context,
      config,
      detailsListConfig,
      detailsItemData,
    )

    // Simulate an unmodified Save: the client form state starts as `initialData`.
    const submitted = transformItemFormData(serializableFields, initialData)

    expect(submitted).not.toHaveProperty('_count')
    expect(submitted).toEqual({ title: 'Hello' })
  })

  it('drops `_count` even if it somehow survived into the form fields map (hardening)', () => {
    // Defense-in-depth: even if a future regression let `_count` leak into
    // `detailsItemData`, `transformItemFormData` drops any key absent from the
    // fields map, so it still cannot reach the update payload.
    const fields = { title: { type: 'text' } }
    const formData = { title: 'Hello', _count: { comments: 5 } }
    expect(transformItemFormData(fields, formData)).toEqual({ title: 'Hello' })
  })
})
