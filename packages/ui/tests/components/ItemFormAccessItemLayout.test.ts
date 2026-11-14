import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { relationship, text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { buildDetailsItemData, composeItemViewRead } from '../../src/components/ItemForm.js'
import { buildRelationshipInclude, prepareItemForm } from '../../src/lib/prepareItemForm.js'
import { deriveItemViewLayout } from '../../src/lib/deriveItemView.js'
import { FIELD_WRITE_DENIED_REASON } from '../../src/lib/serializeFieldConfig.js'

/**
 * The derived item-view layout's details form answers each row-dependent
 * update rule as the update itself does: against the edited row as stored
 * (#1402).
 */
function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Post: {
        fields: {
          title: text({
            access: {
              update: ({ item }) => Array.isArray(item?.comments) && item.comments.length === 0,
            },
          }),
          status: text(),
          draft: text({
            access: {
              read: ({ item }) => Array.isArray(item?.comments) && item.comments.length === 0,
            },
          }),
          summary: text({ access: { update: ({ item }) => item?.status !== 'locked' } }),
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

describe('the derived item-view layout answers field access as the update does (#1402)', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(makeConfig(), null)
  }, 120_000)

  afterAll(async () => {
    await harness?.close()
  })

  function contextOf(): AccessContext {
    return harness.context as unknown as AccessContext
  }

  async function prepareDetailsForm(postId: string) {
    const config = makeConfig()
    const context = contextOf()
    const listConfig = config.lists.Post
    const layout = deriveItemViewLayout(config, 'Post')
    expect(layout.sections).toHaveLength(1)

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

    return prepareItemForm(
      context,
      config,
      'Post',
      detailsListConfig,
      buildDetailsItemData(itemData, layout),
      'update',
      postId,
    )
  }

  async function createPost(status: string): Promise<string> {
    const post = await contextOf().db.Post.create({
      data: { title: 't', status, summary: 's', draft: 'visible' },
    })
    return String(post?.id)
  }

  it('marks a field read-only on a row its rule denies and editable on one it allows', async () => {
    const open = await prepareDetailsForm(await createPost('open'))
    const locked = await prepareDetailsForm(await createPost('locked'))

    expect(open.serializableFields.summary.readOnly).toBeUndefined()
    expect(locked.serializableFields.summary.readOnly).toBe(true)
    expect(locked.serializableFields.summary.readOnlyReason).toBe(FIELD_WRITE_DENIED_REASON)
  })

  it('marks a field read-only when its rule reads a relation the stored row does not carry, as the update rejects it', async () => {
    const postId = await createPost('open')

    const prepared = await prepareDetailsForm(postId)

    expect(prepared.serializableFields.title.readOnly).toBe(true)
    expect(prepared.serializableFields.title.readOnlyReason).toBe(FIELD_WRITE_DENIED_REASON)
    await expect(
      contextOf().db.Post.update({ where: { id: postId }, data: { title: 'changed' } }),
    ).rejects.toThrow(/title/)
  })

  async function prepareEditForm(postId: string) {
    const config = makeConfig()
    const context = contextOf()
    const listConfig = config.lists.Post
    const itemData = await buildRelationshipInclude(listConfig)
      .reduce((read, fieldName) => read.include(fieldName), context.db.Post.where({ id: postId }))
      .first()
    if (!itemData) throw new Error('the edit read returned nothing')
    return prepareItemForm(context, config, 'Post', listConfig, itemData, 'update', postId)
  }

  it('keeps a relation-reading read rule field and the value the include-read delivered', async () => {
    const prepared = await prepareEditForm(await createPost('open'))

    expect(prepared.serializableFields.draft).toBeDefined()
    expect(prepared.serializableFields.draft.readOnly).toBeUndefined()
    expect(prepared.initialData.draft).toBe('visible')
  })

  it('carries no value for that field on a row whose read rule Field Visibility denies', async () => {
    const postId = await createPost('open')
    await contextOf().db.Comment.create({
      data: { body: 'First', post: { connect: { id: postId } } },
    })

    const prepared = await prepareEditForm(postId)

    expect(prepared.serializableFields.draft).toBeDefined()
    expect(prepared.initialData).not.toHaveProperty('draft')
  })
})
