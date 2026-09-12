import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { relationship, text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import {
  buildAccessItemData,
  buildDetailsItemData,
  composeItemViewRead,
} from '../../src/components/ItemForm.js'
import { prepareItemForm } from '../../src/lib/prepareItemForm.js'
import { deriveItemViewLayout } from '../../src/lib/deriveItemView.js'

/**
 * Regression coverage for the review finding on #1402: in the derived
 * item-view layout (issue #734/#752), `ItemViewLayoutView` builds its form
 * from `detailsItemData`, which has every Relationship-table section field
 * stripped out ENTIRELY — not merely `undefined` — because that data belongs
 * to the tables rendered beside the form, not the form's own payload.
 *
 * Before `buildAccessItemData`, that same stripped object was also what a
 * details field's own CREATE/UPDATE access rule saw as `item` when the item
 * form checked whether the session may write it. A rule reading a section
 * field off `item` (`item.comments?.length === 0`, guarding against exactly
 * the "no item yet" case the field-access docs describe) would see the key
 * missing rather than the row's real relation, and compute a wrong, silent
 * answer instead of hitting the documented "throws → treated as writable"
 * safety net.
 */
function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Post: {
        fields: {
          title: text({
            access: {
              // Locked once the post has comments — the case the review
              // comment's example was modelled on.
              update: ({ item }) => (item?.comments as unknown[] | undefined)?.length === 0,
            },
          }),
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

describe('the derived item-view layout checks field access against the real row (#1402)', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(makeConfig(), null)
  }, 120_000)

  afterAll(async () => {
    await harness?.close()
  })

  async function prepareDetailsForm(postId: string) {
    const config = makeConfig()
    const context = harness.context as unknown as AccessContext
    const listConfig = config.lists.Post
    const layout = deriveItemViewLayout(config, 'Post')
    expect(layout.sections).toHaveLength(1) // sanity: comments became a table section

    const itemData = await composeItemViewRead(
      context.db.Post.where({ id: postId }),
      listConfig,
      layout,
    ).first()
    if (!itemData) throw new Error('the item view read returned nothing')

    const detailsFieldEntries = layout.detailsFields
      .map((fieldName) => [fieldName, listConfig.fields[fieldName]] as const)
      .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => !!entry[1])
    const detailsListConfig = { ...listConfig, fields: Object.fromEntries(detailsFieldEntries) }
    const detailsItemData = buildDetailsItemData(itemData, layout)

    return prepareItemForm(
      context,
      config,
      'Post',
      detailsListConfig,
      detailsItemData,
      'update',
      buildAccessItemData(itemData, layout),
    )
  }

  it('reads the real (bounded) relation, not an empty/missing one, for a details field access rule', async () => {
    const context = harness.context as unknown as AccessContext
    const post = await context.db.Post.create({ data: { title: 'No comments yet' } })
    const postId = String(post?.id)

    const prepared = await prepareDetailsForm(postId)

    // `item.comments` really is `[]` here — the rule's own answer, not the
    // fail-open fallback for a missing/throwing rule.
    expect(prepared.serializableFields.title.readOnly).toBeUndefined()
  })

  it('marks the field read-only once the real relation makes the rule deny', async () => {
    const context = harness.context as unknown as AccessContext
    const post = await context.db.Post.create({ data: { title: 'Has a comment' } })
    const postId = String(post?.id)
    await context.db.Comment.create({
      data: { body: 'First', post: { connect: { id: postId } } },
    })

    const prepared = await prepareDetailsForm(postId)

    expect(prepared.serializableFields.title.readOnly).toBe(true)
  })
})
