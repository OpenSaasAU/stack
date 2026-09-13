import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'

vi.mock('@opensaas/stack-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opensaas/stack-core')>()
  return { ...actual, getRelationshipOptions: vi.fn() }
})

import { getRelationshipOptions } from '@opensaas/stack-core'
import { bigInt, relationship, text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { prepareItemForm } from '../../src/lib/prepareItemForm.js'

/**
 * `getRelationshipOptions` itself — its bounded window, its projection, and
 * its second, id-scoped union query for a currently-selected id that fell
 * outside that window — is pinned exhaustively against a composed-read double
 * in `packages/core/src/query/relationship-options.test.ts` (a legitimate
 * seam: `QueryRunnerContext` is the primitive's own documented structural
 * interface, not a stand-in for the full secured surface). What belongs here
 * is `prepareItemForm`'s OWN orchestration — that it calls the primitive once
 * per relationship field, forwards the right `selectedIds`, runs the fetches
 * concurrently, and shapes the results into `relationshipData` — so the
 * primitive is mocked at the function boundary rather than the whole
 * `AccessContext` being hand-faked (#1373).
 */
const mockedGetRelationshipOptions = vi.mocked(getRelationshipOptions)

const BOOT = 120_000

function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Event: {
        fields: { occurredAtMs: bigInt() },
        access: { operation: { query: () => true, create: () => true } },
      },
      Author: {
        fields: {
          name: text(),
          posts: relationship({ ref: 'Post.author', many: true }),
        },
        access: { operation: { query: () => true, create: () => true } },
      },
      Tag: {
        fields: { name: text(), posts: relationship({ ref: 'Post.tags' }) },
        access: { operation: { query: () => true, create: () => true } },
      },
      Post: {
        fields: {
          title: text(),
          author: relationship({ ref: 'Author.posts' }),
          tags: relationship({ ref: 'Tag.posts', many: true }),
        },
        access: { operation: { query: () => true, create: () => true } },
      },
      // A one-to-one: both ends are `many: false` and exactly one holds the
      // column. `Profile` sorts before `User`, so `Profile.user` owns it.
      User: {
        fields: { name: text(), profile: relationship({ ref: 'Profile.user' }) },
        access: { operation: { query: () => true, create: () => true } },
      },
      Profile: {
        fields: { bio: text(), user: relationship({ ref: 'User.profile' }) },
        access: { operation: { query: () => true, create: () => true } },
      },
    },
  }
}

let harness: TestContext
let context: AccessContext

beforeAll(async () => {
  harness = await createTestContext(makeConfig(), null)
  context = harness.context as unknown as AccessContext
}, BOOT)

afterAll(async () => {
  await harness?.close()
})

beforeEach(() => {
  mockedGetRelationshipOptions.mockReset()
  mockedGetRelationshipOptions.mockResolvedValue([])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('prepareItemForm', () => {
  it('carries a bigInt field value through the JSON round-trip as a bigint, not a throw', async () => {
    const config = makeConfig()

    const { initialData } = await prepareItemForm(
      context,
      config,
      'Event',
      config.lists.Event,
      { id: '1', occurredAtMs: 9007199254740993n },
      'update',
    )

    expect(initialData.occurredAtMs).toBe(9007199254740993n)
  })

  it('fetches relationship options once per relationship field and shapes the result', async () => {
    mockedGetRelationshipOptions.mockImplementation(async (_context, _config, relatedListKey) => {
      if (relatedListKey === 'Author') {
        return [
          { id: 'a1', label: 'Ada Lovelace' },
          { id: 'a2', label: 'Alan Turing' },
        ]
      }
      if (relatedListKey === 'Tag') return [{ id: 't1', label: 'engineering' }]
      return []
    })

    const config = makeConfig()
    const { relationshipData } = await prepareItemForm(
      context,
      config,
      'Post',
      config.lists.Post,
      {},
      'create',
    )

    expect(relationshipData.author).toEqual([
      { id: 'a1', label: 'Ada Lovelace' },
      { id: 'a2', label: 'Alan Turing' },
    ])
    expect(relationshipData.tags).toEqual([{ id: 't1', label: 'engineering' }])
    expect(mockedGetRelationshipOptions).toHaveBeenCalledWith(context, config, 'Author', {
      selectedIds: [],
    })
    expect(mockedGetRelationshipOptions).toHaveBeenCalledWith(context, config, 'Tag', {
      selectedIds: [],
    })
  })

  it('extracts the currently-selected single-relationship id into selectedIds', async () => {
    const config = makeConfig()
    const itemData = { id: 'p1', title: 'Post', author: { id: 'a9', name: 'Currently Selected' } }

    await prepareItemForm(context, config, 'Post', config.lists.Post, itemData, 'update')

    expect(mockedGetRelationshipOptions).toHaveBeenCalledWith(context, config, 'Author', {
      selectedIds: ['a9'],
    })
  })

  it('extracts every currently-selected id for a many relationship into selectedIds', async () => {
    const config = makeConfig()
    const itemData = {
      id: 'p1',
      title: 'Post',
      tags: [
        { id: 't1', name: 'engineering' },
        { id: 't9', name: 'design' },
      ],
    }

    await prepareItemForm(context, config, 'Post', config.lists.Post, itemData, 'update')

    expect(mockedGetRelationshipOptions).toHaveBeenCalledWith(context, config, 'Tag', {
      selectedIds: ['t1', 't9'],
    })
  })

  it('fetches relationship options for multiple fields concurrently, not serially', async () => {
    // Neither terminal ever resolves in this test. If the fetches are kicked
    // off serially (an `await` inside a `for` loop), the Tag read is never
    // even started until the Author one resolves — which it never does here —
    // so `tagCalled` would stay `false` forever. Fetching concurrently starts
    // both before either resolves.
    let authorCalled = false
    let tagCalled = false
    let resolveAuthor!: (value: Array<{ id: string; label: string }>) => void
    let resolveTag!: (value: Array<{ id: string; label: string }>) => void

    mockedGetRelationshipOptions.mockImplementation(async (_context, _config, relatedListKey) => {
      if (relatedListKey === 'Author') {
        authorCalled = true
        return new Promise((resolve) => {
          resolveAuthor = resolve
        })
      }
      if (relatedListKey === 'Tag') {
        tagCalled = true
        return new Promise((resolve) => {
          resolveTag = resolve
        })
      }
      return []
    })

    const config = makeConfig()
    const promise = prepareItemForm(context, config, 'Post', config.lists.Post, {}, 'create')

    expect(authorCalled).toBe(true)
    expect(tagCalled).toBe(true)

    resolveAuthor([])
    resolveTag([])
    await promise
  })

  it('passes no selectedIds when the relationship is empty (create mode)', async () => {
    const config = makeConfig()

    await prepareItemForm(context, config, 'Post', config.lists.Post, {}, 'create')

    expect(mockedGetRelationshipOptions).toHaveBeenCalledWith(context, config, 'Author', {
      selectedIds: [],
    })
  })
})

/**
 * Which relationships the form may collect a value for (ADR-0050): only the
 * end that holds the foreign-key column. Everything else is marked read-only
 * here, which is what stops a control rendering for it — the alternative,
 * dropping the value later in the submit transform, reports success on input
 * that never reached the database.
 */
describe('prepareItemForm relationship writability', () => {
  it('marks a to-many read-only and leaves the foreign-key-owning to-one editable', async () => {
    const config = makeConfig()

    const { serializableFields } = await prepareItemForm(
      context,
      config,
      'Post',
      config.lists.Post,
      {},
      'create',
    )

    expect(serializableFields.tags.readOnly).toBe(true)
    expect(serializableFields.tags.readOnlyReason).toEqual(expect.stringContaining('Not editable'))
    expect(serializableFields.author.readOnly).toBeUndefined()
  })

  it('marks only the non-owning end of a one-to-one read-only', async () => {
    // Both ends are `many: false`, so arity cannot tell them apart; only
    // ownership of the column can. `Profile.user` holds it.
    const config = makeConfig()

    const { serializableFields: userFields } = await prepareItemForm(
      context,
      config,
      'User',
      config.lists.User,
      {},
      'create',
    )
    const { serializableFields: profileFields } = await prepareItemForm(
      context,
      config,
      'Profile',
      config.lists.Profile,
      {},
      'create',
    )

    expect(userFields.profile.readOnly).toBe(true)
    expect(userFields.profile.readOnlyReason).toEqual(expect.stringContaining('Not editable'))
    expect(profileFields.user.readOnly).toBeUndefined()
  })
})
