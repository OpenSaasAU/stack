import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { relationship, text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { buildDetailsItemData, composeItemViewRead } from '../../src/components/ItemForm.js'
import { prepareItemForm } from '../../src/lib/prepareItemForm.js'
import { transformItemFormData } from '../../src/lib/useItemForm.js'
import { deriveItemViewLayout } from '../../src/lib/deriveItemView.js'

/**
 * Regression coverage for issue #797: the derived item view (issue #734/#752)
 * fetches each Relationship table's section as rows beside the total its
 * "Showing N of M" footer needs, so the section key carries a shape that is not
 * a field of the list. Before this fix the synthetic payload rode through
 * `detailsItemData` -> `prepareItemForm` -> `transformItemFormData` and ended
 * up in every update payload, which the server rejected ("it is not a field of
 * this list") — Save silently failed on the edit page for ANY list with a
 * `many: true` relationship rendered as a table (the default display mode).
 *
 * This threads the real fetch -> details-data -> submit-transform pipeline
 * `ItemViewLayoutView` runs (`buildDetailsItemData` -> `prepareItemForm` ->
 * `transformItemFormData`), the same functions the component calls, without
 * needing to render the async Relationship-table server components (not
 * supported by this test environment's React DOM renderer).
 */

/**
 * A list with a `many: true` relationship in the default (table) item-view
 * display mode — the shape that makes `deriveItemViewLayout` produce a
 * Relationship-table section and routes the edit page through
 * `ItemViewLayoutView`.
 */
function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Post: {
        fields: {
          title: text(),
          comments: relationship({ ref: 'Comment.post', many: true }),
        },
        access: { operation: { query: () => true, create: () => true, update: () => true } },
      },
      Comment: {
        fields: {
          body: text(),
          post: relationship({ ref: 'Post.comments' }),
        },
        access: { operation: { query: () => true, create: () => true } },
      },
    },
  }
}

describe('ItemForm derived item-view pipeline (issue #797 regression)', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(makeConfig(), null)
  }, 120_000)

  afterAll(async () => {
    await harness?.close()
  })

  it('never lets the section branch payload survive fetch -> details data -> submit transform', async () => {
    const config = makeConfig()
    const layout = deriveItemViewLayout(config, 'Post')
    expect(layout.sections).toHaveLength(1) // sanity: the to-many relationship became a table section

    const context = harness.context as unknown as AccessContext

    const post = await context.db.Post.create({ data: { title: 'Hello' } })
    await context.db.Comment.create({
      data: { body: 'Nice post', post: { connect: { id: post?.id } } },
    })

    // The record `ItemViewLayoutView` fetches, from the read it actually
    // issues: the real fields, plus the section key carrying the bounded rows
    // beside the footer's total.
    const itemData = await composeItemViewRead(
      context.db.Post.where({ id: post?.id }),
      config.lists.Post,
      layout,
    ).first()
    if (!itemData) throw new Error('the item view read returned nothing')
    expect(itemData.comments).toMatchObject({ total: 1 })

    const detailsItemData = buildDetailsItemData(itemData, layout)
    expect(detailsItemData).not.toHaveProperty('comments') // section field, not a details field
    expect(detailsItemData).toMatchObject({ id: post?.id, title: 'Hello' })

    const detailsListConfig = {
      ...config.lists.Post,
      fields: Object.fromEntries(
        layout.detailsFields.map((fieldName) => [fieldName, config.lists.Post.fields[fieldName]]),
      ),
    }

    const { serializableFields, initialData } = await prepareItemForm(
      context,
      config,
      'Post',
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
