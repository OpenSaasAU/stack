import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { relationship, text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { buildDetailsItemData, composeItemViewRead } from '../../src/components/ItemForm.js'
import { prepareItemForm } from '../../src/lib/prepareItemForm.js'
import { deriveItemViewLayout } from '../../src/lib/deriveItemView.js'

/**
 * A details field whose update rule reads the row is row-dependent in the
 * Session vocabulary, so the derived item-view layout keeps it editable
 * whatever the row holds; the secured write decides (ADR-0084).
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

describe('the derived item-view layout keeps a row-dependent update rule editable', () => {
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

    return prepareItemForm(context, config, 'Post', detailsListConfig, detailsItemData, 'update')
  }

  it('leaves the field editable on a row the rule would allow', async () => {
    const context = harness.context as unknown as AccessContext
    const post = await context.db.Post.create({ data: { title: 'No comments yet' } })
    const postId = String(post?.id)

    const prepared = await prepareDetailsForm(postId)

    expect(prepared.serializableFields.title.readOnly).toBeUndefined()
  })

  it('leaves the field editable on a row the rule would deny', async () => {
    const context = harness.context as unknown as AccessContext
    const post = await context.db.Post.create({ data: { title: 'Has a comment' } })
    const postId = String(post?.id)
    await context.db.Comment.create({
      data: { body: 'First', post: { connect: { id: postId } } },
    })

    const prepared = await prepareDetailsForm(postId)

    expect(prepared.serializableFields.title.readOnly).toBeUndefined()
  })
})
