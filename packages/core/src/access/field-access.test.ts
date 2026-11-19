import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  checkFieldAccess,
  checkRowRead,
  classifyRowIndependentCreateAccess,
  classifyRowIndependentRead,
  classifyRowIndependentWrite,
  filterWritableFields,
  isFieldReadableForPredicate,
} from './field-access.js'
import { NO_RULE_VIEWS, ruleRowOf } from './rule-item.js'
import { InvalidFieldAccessResultError } from './errors.js'
import { ValidationError } from '../hooks/index.js'
import type { FieldAccess, FieldAccessControl } from './types.js'
import { checkbox, relationship, text, virtual } from '../fields/index.js'
import type { FieldConfig, OpenSaasConfig } from '../config/types.js'

// A non-sudo access context. The cast is localized to test setup (mirrors the
// existing sudo-context casts in this file): the runtime AccessContext carries
// Prisma plumbing the unit under test never touches.
function nonSudoContext() {
  return {
    session: null,
    _isSudo: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function onList(
  fields: Record<string, FieldConfig>,
  lists: OpenSaasConfig['lists'] = {},
): { listName: string; config: OpenSaasConfig } {
  return {
    listName: 'Post',
    config: {
      db: { provider: 'postgresql' },
      lists: { User: { fields: { name: text() } }, ...lists, Post: { fields } },
    },
  }
}

const mediaField: FieldConfig = {
  type: 'image',
  outputType: 'unknown',
  getContractField: (fieldName) => ({
    kind: 'columns',
    columns: [
      { name: `${fieldName}_url`, type: { pack: 'pg', type: 'text' }, nullable: true },
      { name: `${fieldName}_size`, type: { pack: 'pg', type: 'int' }, nullable: true },
    ],
  }),
  assembleColumns: (fieldName, row) => row[`${fieldName}_url`],
}

function sudoContext() {
  return {
    session: null,
    _isSudo: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

// ── #914: `FieldAccess['read']`'s `item` must type as present, matching what
// Field Visibility (field-visibility.ts) actually passes ──

describe("FieldAccess['read'] item typing (issue #914)", () => {
  type Item = { ownerId: string }

  it('types item as present for a read rule that reads a property off it — no cast, no `any`', () => {
    const fieldAccess: FieldAccess<Item> = {
      read: ({ session, item }) => item.ownerId === session?.userId,
    }
    expect(typeof fieldAccess.read).toBe('function')
  })

  it('still compiles a read rule that ignores item entirely', () => {
    const fieldAccess: FieldAccess<Item> = {
      read: () => true,
    }
    expect(typeof fieldAccess.read).toBe('function')
  })

  it('leaves the create branch unchanged — item is still absent, there genuinely is no row yet', () => {
    // Pinned against `FieldAccessControl`'s discriminated union directly
    // (rather than `FieldAccess['create']`'s destructured callback), because
    // `create`/`update` — unlike `read` — are untouched by this fix and keep
    // accepting the full `FieldAccessControl` union in `FieldAccess`.
    type CreateArgs = Extract<Parameters<FieldAccessControl<Item>>[0], { operation: 'create' }>
    expectTypeOf<CreateArgs['item']>().toEqualTypeOf<undefined>()
  })

  // Type-level pin: `resolveReadableFieldValue` (field-visibility.ts) is the
  // sole caller of `checkFieldAccess` for `operation: 'read'`, and always
  // supplies `item: accessItem` — a full row, never `undefined`. This
  // assertion has no runtime effect (`expectTypeOf` is a no-op outside
  // `vitest --typecheck`); its value is that `pnpm build`/`tsc` fails on this
  // file the moment `FieldAccess['read']`'s `item` type drifts back to
  // optional/absent, so the declared type and the call site cannot silently
  // diverge again.
  it("pins FieldAccess['read']'s item type against the field-visibility.ts call site", () => {
    type ReadArgs = Parameters<NonNullable<FieldAccess<Item>['read']>>[0]
    expectTypeOf<ReadArgs['item']>().toEqualTypeOf<Item>()
    expectTypeOf<ReadArgs['operation']>().toEqualTypeOf<'read'>()
  })
})

// ── #913: a field rule returning a filter must not be granted blanket access ──

describe('checkFieldAccess', () => {
  it('allows when the rule returns true', async () => {
    const allowed = await checkFieldAccess({ read: () => true }, 'read', {
      session: null,
      item: { ownerId: 'someone-else' },
      context: nonSudoContext(),
    })
    expect(allowed).toBe(true)
  })

  it('denies when the rule returns false', async () => {
    const allowed = await checkFieldAccess({ read: () => false }, 'read', {
      session: null,
      item: { ownerId: 'someone-else' },
      context: nonSudoContext(),
    })
    expect(allowed).toBe(false)
  })

  it('allows when no field access is configured', async () => {
    const allowed = await checkFieldAccess(undefined, 'read', {
      session: null,
      context: nonSudoContext(),
    })
    expect(allowed).toBe(true)
  })

  it('allows when no rule is configured for the operation', async () => {
    const allowed = await checkFieldAccess({ update: () => false }, 'read', {
      session: null,
      context: nonSudoContext(),
    })
    expect(allowed).toBe(true)
  })

  it('throws InvalidFieldAccessResultError, not allow, when a read rule returns a filter', async () => {
    // The exact reproduction from the issue: a rule written to scope a field
    // by row, which the previous fail-open default granted full access to.
    const fieldAccess = {
      read: () => ({ ownerId: { equals: 'someone-else' } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    await expect(
      checkFieldAccess(fieldAccess, 'read', {
        session: null,
        item: { ownerId: 'the-owner' },
        context: nonSudoContext(),
      }),
    ).rejects.toThrow(InvalidFieldAccessResultError)
  })

  it('throws for a filter-returning rule on create, where there is no item to test it against', async () => {
    const fieldAccess = {
      create: () => ({ ownerId: { equals: 'someone-else' } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    await expect(
      checkFieldAccess(fieldAccess, 'create', {
        session: null,
        context: nonSudoContext(),
        inputData: { ownerId: 'the-owner' },
      }),
    ).rejects.toThrow(InvalidFieldAccessResultError)
  })

  it('throws for a filter-returning rule on update', async () => {
    const fieldAccess = {
      update: () => ({ ownerId: { equals: 'someone-else' } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    await expect(
      checkFieldAccess(fieldAccess, 'update', {
        session: null,
        item: { ownerId: 'the-owner' },
        context: nonSudoContext(),
        inputData: { ownerId: 'someone-else' },
      }),
    ).rejects.toThrow(InvalidFieldAccessResultError)
  })

  it('denies when the rule returns undefined', async () => {
    const fieldAccess = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      read: () => undefined as any,
    }

    await expect(
      checkFieldAccess(fieldAccess, 'read', {
        session: null,
        item: {},
        context: nonSudoContext(),
      }),
    ).resolves.toBe(false)
  })

  it('denies on null, and throws a descriptive message for other primitive results', async () => {
    const nullAccess = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      read: () => null as any,
    }
    await expect(
      checkFieldAccess(nullAccess, 'read', {
        session: null,
        item: {},
        context: nonSudoContext(),
      }),
    ).resolves.toBe(false)

    const numberAccess = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      read: () => 42 as any,
    }
    await expect(
      checkFieldAccess(numberAccess, 'read', {
        session: null,
        item: {},
        context: nonSudoContext(),
      }),
    ).rejects.toThrow(/returned a number, not a boolean/)
  })

  it('sudo bypasses the rule entirely, so a filter-returning rule never reaches the throw', async () => {
    const fieldAccess = {
      read: () => ({ ownerId: { equals: 'someone-else' } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    const allowed = await checkFieldAccess(fieldAccess, 'read', {
      session: null,
      item: { ownerId: 'the-owner' },
      context: sudoContext(),
    })
    expect(allowed).toBe(true)
  })
})

describe('isFieldReadableForPredicate (#915)', () => {
  it('allows when there is no field access configured', async () => {
    const readable = await isFieldReadableForPredicate(undefined, {
      session: null,
      context: nonSudoContext(),
    })
    expect(readable).toBe(true)
  })

  it('allows when the rule only inspects session (never touches item)', async () => {
    const readable = await isFieldReadableForPredicate(
      { read: ({ session }) => session?.userId === 'admin' },
      { session: { userId: 'admin' }, context: nonSudoContext() },
    )
    expect(readable).toBe(true)
  })

  it('denies when the rule returns false', async () => {
    const readable = await isFieldReadableForPredicate(
      { read: () => false },
      { session: null, context: nonSudoContext() },
    )
    expect(readable).toBe(false)
  })

  it('denies a row-dependent rule that dereferences `item` directly', async () => {
    const readable = await isFieldReadableForPredicate(
      { read: ({ item, session }) => item.ownerId === session?.userId },
      { session: { userId: 'user-1' }, context: nonSudoContext() },
    )
    expect(readable).toBe(false)
  })

  it('denies a row-dependent rule even when it reads `item` via optional chaining', async () => {
    // This is the exact idiom `InvalidFieldAccessResultError`'s own message
    // recommends (`item?.ownerId === session?.userId`) — it must still deny,
    // not silently misevaluate `undefined === session?.userId` against a
    // poisoned `item`.
    const readable = await isFieldReadableForPredicate(
      { read: ({ item, session }) => item?.ownerId === session?.userId },
      { session: null, context: nonSudoContext() },
    )
    expect(readable).toBe(false)
  })

  it('denies a row-dependent rule that only enumerates `item`s keys', async () => {
    const readable = await isFieldReadableForPredicate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { read: ({ item }) => Object.keys(item as any).length > 0 },
      { session: null, context: nonSudoContext() },
    )
    expect(readable).toBe(false)
  })

  it('propagates InvalidFieldAccessResultError instead of folding it into a denial', async () => {
    const fieldAccess = {
      read: () => ({ ownerId: { equals: 'someone-else' } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    await expect(
      isFieldReadableForPredicate(fieldAccess, { session: null, context: nonSudoContext() }),
    ).rejects.toThrow(InvalidFieldAccessResultError)
  })

  it('propagates a genuine error the rule throws for its own reasons, not just non-boolean results', async () => {
    // The rule never touches `item` — it throws for a reason of its own.
    // This must NOT be folded into an ordinary `false` denial (that would
    // mask a real bug in the rule as "field not readable"), matching how the
    // post-query path (Field Visibility) already lets such a throw
    // propagate unchanged.
    const fieldAccess: FieldAccess = {
      read: ({ session }) => {
        if (session === null) throw new Error('unexpected anonymous access')
        return true
      },
    }

    await expect(
      isFieldReadableForPredicate(fieldAccess, { session: null, context: nonSudoContext() }),
    ).rejects.toThrow('unexpected anonymous access')
  })

  it('sudo bypasses the rule entirely, so a row-dependent rule never denies', async () => {
    const readable = await isFieldReadableForPredicate(
      { read: ({ item, session }) => item.ownerId === session?.userId },
      { session: null, context: sudoContext() },
    )
    expect(readable).toBe(true)
  })
})

describe('filterWritableFields', () => {
  it('keeps a directly-written foreign-key column alongside its relationship field (#1326)', async () => {
    // Setup: Define field configs with a relationship field
    const fieldConfigs = {
      title: text(),
      author: relationship({ ref: 'User' }),
      tags: relationship({ ref: 'Tag.post', many: true }),
    }
    const lists = { Tag: { fields: { post: relationship({ ref: 'Post.tags' }) } } }

    // Data that includes both the foreign key (authorId) and other fields
    const data = {
      title: 'Test Post',
      authorId: 'user-123', // A legitimate spelling of the same edge `connect` lowers to (#1326)
      author: {
        connect: { id: 'user-123' },
      },
    }

    const filtered = await filterWritableFields(data, 'create', {
      ...onList(fieldConfigs, lists),
      session: null,
      context: {
        session: null,
        _isSudo: true, // Use sudo to bypass access control checks
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      inputData: data,
    })

    // authorId is a real column write, not a silent drop (#1326)
    expect(filtered).toHaveProperty('authorId', 'user-123')

    // title should remain
    expect(filtered).toHaveProperty('title', 'Test Post')

    // author relationship should remain
    expect(filtered).toHaveProperty('author')
    expect(filtered.author).toEqual({ connect: { id: 'user-123' } })

    // tags is many: true, so `tagsId` names no foreign key and is refused as undeclared
    const withTagsId = { ...data, tagsId: 'tag-456' }
    await expect(
      filterWritableFields(withTagsId, 'create', {
        ...onList(fieldConfigs, lists),
        session: null,
        context: sudoContext(),
        inputData: withTagsId,
      }),
    ).rejects.toThrow('"tagsId": it is not a field of this list')
  })

  it.each([
    ['id', { id: 'post-123' }],
    ['createdAt', { createdAt: new Date() }],
    ['updatedAt', { updatedAt: new Date() }],
  ])('refuses system field %s, even under sudo', async (name, extra) => {
    const data = { title: 'Test', ...extra }
    const fields = { title: text() }
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql', timestamps: true },
      lists: { Post: { fields } },
    }
    await expect(
      filterWritableFields(data, 'create', {
        session: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        context: { session: null, _isSudo: true } as any,
        inputData: data,
        listName: 'Post',
        config,
      }),
    ).rejects.toThrow(new RegExp(`"${name}": it is system-managed`))
  })

  it('refuses an undeclared createdAt as unknown on a list without timestamps', async () => {
    const data = { title: 'Test', createdAt: new Date() }
    const fields = { title: text() }
    const config: OpenSaasConfig = { db: { provider: 'postgresql' }, lists: { Post: { fields } } }
    await expect(
      filterWritableFields(data, 'create', {
        session: null,
        context: nonSudoContext(),
        inputData: data,
        listName: 'Post',
        config,
      }),
    ).rejects.toThrow(/"createdAt": it is not a field of this list/)
  })

  it('treats a declared createdAt as an ordinary field', async () => {
    const data = { createdAt: 'hello' }
    const fields = { createdAt: text() }
    const filtered = await filterWritableFields(data, 'create', {
      ...onList(fields),
      session: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      context: { session: null } as any,
      inputData: data,
    })
    expect(filtered).toEqual({ createdAt: 'hello' })
  })

  it('should handle update operation', async () => {
    const fieldConfigs = {
      title: text(),
      author: relationship({ ref: 'User' }),
    }

    const data = {
      title: 'Updated Title',
      authorId: 'user-456', // A legitimate direct column write (#1326)
      author: {
        connect: { id: 'user-456' },
      },
    }

    const filtered = await filterWritableFields(data, 'update', {
      ...onList(fieldConfigs),
      session: null,
      item: { id: 'post-123' },
      context: {
        session: null,
        _isSudo: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      inputData: data,
    })

    expect(filtered).toHaveProperty('authorId', 'user-456')
    expect(filtered).toHaveProperty('title', 'Updated Title')
    expect(filtered).toHaveProperty('author')
  })

  it('distinguishes a regular field that happens to end with "Id" from a real foreign key', async () => {
    const fieldConfigs = {
      trackingId: text(), // Regular field that happens to end with "Id"
      author: relationship({ ref: 'User' }),
    }

    const data = {
      trackingId: 'track-123', // An ordinary declared field
      authorId: 'user-456', // The author relationship's foreign-key column (#1326)
    }

    const filtered = await filterWritableFields(data, 'create', {
      ...onList(fieldConfigs),
      session: null,
      context: {
        session: null,
        _isSudo: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      inputData: data,
    })

    // trackingId is a defined field, so it should remain
    expect(filtered).toHaveProperty('trackingId', 'track-123')

    // authorId is a foreign key for author relationship — a real column write, not dropped
    expect(filtered).toHaveProperty('authorId', 'user-456')
  })

  // ── #564: undeclared data keys must fail CLOSED (throw) for non-sudo writes ──

  it('throws on an undeclared data key for a non-sudo create', async () => {
    const fieldConfigs = { title: text() }
    const data = {
      title: 'Test',
      // Not a declared field — e.g. a Prisma back-relation the config never
      // exposed (`from_Enrolment_student`). Must be rejected, not passed through.
      from_Enrolment_student: { disconnect: [{ id: 'e1' }] },
    }

    await expect(
      filterWritableFields(data, 'create', {
        ...onList(fieldConfigs),
        session: null,
        context: nonSudoContext(),
        inputData: data,
      }),
    ).rejects.toThrow(ValidationError)
    await expect(
      filterWritableFields(data, 'create', {
        ...onList(fieldConfigs),
        session: null,
        context: nonSudoContext(),
        inputData: data,
      }),
    ).rejects.toThrow(/from_Enrolment_student/)
  })

  it('throws on an undeclared data key for a non-sudo update', async () => {
    const fieldConfigs = { title: text() }
    const data = {
      title: 'Updated',
      bogusKey: 'value',
    }

    await expect(
      filterWritableFields(data, 'update', {
        ...onList(fieldConfigs),
        session: null,
        item: { id: 'post-1' },
        context: nonSudoContext(),
        inputData: data,
      }),
    ).rejects.toThrow(/bogusKey/)
  })

  it('keeps a directly-written FK column with no field access declared, for a non-sudo write', async () => {
    const fieldConfigs = {
      title: text(),
      author: relationship({ ref: 'User' }),
    }
    const data = {
      title: 'Test',
      authorId: 'user-1', // No `access` on `author` — `checkFieldAccess` allows (#1326)
    }

    const filtered = await filterWritableFields(data, 'create', {
      ...onList(fieldConfigs),
      session: null,
      context: nonSudoContext(),
      inputData: data,
    })

    expect(filtered).toHaveProperty('authorId', 'user-1')
    expect(filtered).toHaveProperty('title', 'Test')
  })

  const mediaConfigs = { media: mediaField }

  it('passes through part columns the field produced itself (not in caller input)', async () => {
    const data = { media_url: 'https://x/y.jpg', media_size: 99 }

    const filtered = await filterWritableFields(data, 'create', {
      ...onList(mediaConfigs),
      session: null,
      context: nonSudoContext(),
      inputData: { media: { url: 'https://x/y.jpg' } },
    })

    expect(filtered).toHaveProperty('media_url', 'https://x/y.jpg')
    expect(filtered).toHaveProperty('media_size', 99)
  })

  it('THROWS when a hook swaps a write-denied logical key for its part columns', async () => {
    const configs = {
      media: { ...mediaConfigs.media, access: { create: () => false, update: () => false } },
    }

    await expect(
      filterWritableFields({ media_url: 'https://x/y.jpg', media_size: 1 }, 'create', {
        ...onList(configs),
        session: null,
        context: nonSudoContext(),
        inputData: { media: { url: 'https://x/y.jpg' } },
      }),
    ).rejects.toThrow(/"media".*access denied/)
  })

  for (const [label, makeContext] of [
    ['non-sudo', nonSudoContext],
    ['sudo', sudoContext],
  ] as const) {
    for (const operation of ['create', 'update'] as const) {
      it(`THROWS when a caller supplies a raw part column (${label}, ${operation})`, async () => {
        const data = { media_url: 'javascript:alert(1)', media_size: 5 }

        const result = filterWritableFields(data, operation, {
          ...onList(mediaConfigs),
          session: null,
          item: operation === 'update' ? { id: 'item-1' } : undefined,
          context: makeContext(),
          inputData: data,
        })

        await expect(result).rejects.toThrow(ValidationError)
        await expect(result).rejects.toThrow(/"media_url".*"media"/)
      })
    }
  }

  // ── #1326: a directly-written foreign-key column must not be silently
  // dropped, and must enforce the same write access as the owning
  // relationship field (`connect` lowers to the same column, ADR-0050) ──────

  it('THROWS when a directly-written foreign-key column is supplied for a relationship whose write access is DENIED (non-sudo)', async () => {
    const fieldConfigs = {
      author: relationship({
        ref: 'User',
        access: { create: () => false, update: () => false },
      }),
    }
    const data = { authorId: 'user-123' }

    // Throws ValidationError, and the message names the owning field — never a
    // silent drop of the key (the original defect this pins).
    await expect(
      filterWritableFields(data, 'create', {
        ...onList(fieldConfigs),
        session: null,
        context: nonSudoContext(),
        inputData: data,
      }),
    ).rejects.toThrow(ValidationError)
    await expect(
      filterWritableFields(data, 'create', {
        ...onList(fieldConfigs),
        session: null,
        context: nonSudoContext(),
        inputData: data,
      }),
    ).rejects.toThrow(/author/)
  })

  it('passes a directly-written foreign-key column through when the owning relationship field ALLOWS (non-sudo)', async () => {
    const fieldConfigs = {
      author: relationship({
        ref: 'User',
        access: { create: () => true, update: () => true },
      }),
    }
    const data = { authorId: 'user-123' }

    const filtered = await filterWritableFields(data, 'create', {
      ...onList(fieldConfigs),
      session: null,
      context: nonSudoContext(),
      inputData: data,
    })

    expect(filtered).toHaveProperty('authorId', 'user-123')
  })

  it('passes a directly-written foreign-key column through under sudo regardless of denied owning-field access', async () => {
    const fieldConfigs = {
      author: relationship({
        ref: 'User',
        access: { create: () => false, update: () => false },
      }),
    }
    const data = { authorId: 'user-123' }

    const filtered = await filterWritableFields(data, 'create', {
      ...onList(fieldConfigs),
      session: null,
      context: sudoContext(),
      inputData: data,
    })

    expect(filtered).toHaveProperty('authorId', 'user-123')
  })

  it('rejects the FK-shaped key on the non-owning side of a one-to-one, rather than writing a column that does not exist (#1326)', async () => {
    // `User.profile` is the NON-owning side (`Profile.user` claims the FK via
    // `db.foreignKey: true`, ADR-0064) — the User model has no `profileId`
    // column at all. A naive "every to-one owns `<field>Id`" heuristic would
    // treat `profileId` as a legitimate write here and hand it to the ORM,
    // which has no such column. It must instead be refused as the undeclared
    // key it is (#564), the same outcome as any other unrecognised key.
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        User: { fields: { name: text(), profile: relationship({ ref: 'Profile.user' }) } },
        Profile: {
          fields: { user: relationship({ ref: 'User.profile', db: { foreignKey: true } }) },
        },
      },
    }
    const data = { name: 'Ada', profileId: 'p1' }

    await expect(
      filterWritableFields(data, 'create', {
        session: null,
        context: nonSudoContext(),
        inputData: data,
        listName: 'User',
        config,
      }),
    ).rejects.toThrow(ValidationError)
    await expect(
      filterWritableFields(data, 'create', {
        session: null,
        context: nonSudoContext(),
        inputData: data,
        listName: 'User',
        config,
      }),
    ).rejects.toThrow(/profileId/)
  })

  it('keeps the FK-shaped key on the owning side of the same one-to-one', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        User: { fields: { name: text(), profile: relationship({ ref: 'Profile.user' }) } },
        Profile: {
          fields: { user: relationship({ ref: 'User.profile', db: { foreignKey: true } }) },
        },
      },
    }
    const data = { userId: 'u1' }

    const filtered = await filterWritableFields(data, 'create', {
      session: null,
      context: nonSudoContext(),
      inputData: data,
      listName: 'Profile',
      config,
    })

    expect(filtered).toHaveProperty('userId', 'u1')
  })

  it('refuses a stripped denied edge under both the relation and foreign-key spellings (#1975)', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        User: { fields: { posts: relationship({ ref: 'Post.author', many: true }) } },
        Post: {
          fields: {
            title: text(),
            author: relationship({ ref: 'User.posts', access: { update: () => false } }),
          },
        },
      },
    }
    const spellings = [{ author: { connect: { id: 'u1' } } }, { authorId: 'u1' }]

    for (const inputData of spellings) {
      const messages: string[] = []
      await filterWritableFields({ title: 'x' }, 'update', {
        session: null,
        item: { id: 'post-1' },
        context: nonSudoContext(),
        inputData: { title: 'x', ...inputData },
        listName: 'Post',
        config,
      }).catch((error: Error) => messages.push(error.message))
      expect(messages).toEqual([
        'Validation failed: Cannot update "author": field-level access denied.',
      ])
    }
  })

  it('ignores an undefined foreign key and lets sudo through (#1975)', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        User: { fields: { posts: relationship({ ref: 'Post.author', many: true }) } },
        Post: {
          fields: {
            title: text(),
            author: relationship({ ref: 'User.posts', access: { update: () => false } }),
          },
        },
      },
    }
    const args = { session: null, item: { id: 'post-1' }, listName: 'Post', config }

    await expect(
      filterWritableFields({ title: 'x' }, 'update', {
        ...args,
        context: nonSudoContext(),
        inputData: { title: 'x', authorId: undefined },
      }),
    ).resolves.toEqual({ title: 'x' })
    await expect(
      filterWritableFields({ title: 'x' }, 'update', {
        ...args,
        context: sudoContext(),
        inputData: { title: 'x', authorId: 'u1' },
      }),
    ).resolves.toEqual({ title: 'x' })
  })

  // ── #568: field-access-denied keys must THROW, not be silently stripped ──────

  it('throws when a declared field is denied by field-level access (non-sudo)', async () => {
    const fieldConfigs = {
      title: text(),
      status: text({ access: { update: () => false, create: () => false } }),
    }
    const data = { title: 'Test', status: 'published' }

    await expect(
      filterWritableFields(data, 'update', {
        ...onList(fieldConfigs),
        session: null,
        item: { id: 'post-1' },
        context: nonSudoContext(),
        inputData: data,
      }),
    ).rejects.toThrow(/status/)
  })

  // ── #913: a field rule returning a filter must not grant blanket write access ──

  it('throws InvalidFieldAccessResultError, not a blanket write, when field access returns a filter (non-sudo)', async () => {
    const fieldConfigs = {
      title: text(),
      status: {
        ...text(),
        access: {
          // Written as a row-scoping rule; field access does not honour filters.
          update: () => ({ status: { equals: 'draft' } }),
          create: () => ({ status: { equals: 'draft' } }),
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    const data = { title: 'Test', status: 'published' }

    await expect(
      filterWritableFields(data, 'update', {
        ...onList(fieldConfigs),
        session: null,
        item: { id: 'post-1', status: 'draft' },
        context: nonSudoContext(),
        inputData: data,
      }),
    ).rejects.toThrow(InvalidFieldAccessResultError)
  })

  it('does NOT throw on a would-be-denied field under sudo', async () => {
    const fieldConfigs = {
      title: text(),
      status: text({ access: { update: () => false, create: () => false } }),
    }
    const data = { title: 'Test', status: 'published' }

    const filtered = await filterWritableFields(data, 'update', {
      ...onList(fieldConfigs),
      session: null,
      item: { id: 'post-1' },
      context: sudoContext(),
      inputData: data,
    })

    expect(filtered).toHaveProperty('title', 'Test')
    expect(filtered).toHaveProperty('status', 'published')
  })

  it('passes a declared relationship field through to nested operations (non-sudo)', async () => {
    const fieldConfigs = {
      title: text(),
      author: relationship({ ref: 'User' }),
    }
    const data = {
      title: 'Test',
      author: { connect: { id: 'user-1' } },
    }

    const filtered = await filterWritableFields(data, 'create', {
      ...onList(fieldConfigs),
      session: null,
      context: nonSudoContext(),
      inputData: data,
    })

    expect(filtered).toHaveProperty('author')
    expect(filtered.author).toEqual({ connect: { id: 'user-1' } })
  })
})

// ── `defaultedFields`: a create-denied field's own declared default must
// still persist when everyone (caller, hooks) left it omitted — the deny
// stops the CALLER from writing the field, not the field's own default
// (issue #1618/ADR-0073; see `applyCreateDefaults`'s own doc comment for the
// full mechanics of how a key lands in this set) ──────────────────────────

describe('filterWritableFields — defaultedFields exemption (opt-in via allowCreateDefault)', () => {
  it('passes a create-denied field through when it opts in with allowCreateDefault and its key is in defaultedFields', async () => {
    const fieldConfigs = {
      emailVerified: checkbox({
        access: { create: () => false, update: () => false, allowCreateDefault: true },
      }),
    }
    const data = { emailVerified: false }

    const filtered = await filterWritableFields(data, 'create', {
      ...onList(fieldConfigs),
      session: null,
      context: nonSudoContext(),
      inputData: {}, // the caller never supplied it — applyCreateDefaults did
      defaultedFields: new Set(['emailVerified']),
    })

    expect(filtered).toHaveProperty('emailVerified', false)
  })

  it('still throws for a create-denied field in defaultedFields when allowCreateDefault is NOT set (default, off)', async () => {
    // The `total`-style case (packages/core/src/mcp/handler.test.ts): a
    // session-dependent `create` rule must still block the WHOLE create for
    // a denied session, defaultValue or not — `allowCreateDefault` is opt-in
    // precisely so this existing, deliberate behaviour is unaffected.
    const fieldConfigs = {
      total: text({ access: { create: () => false } }),
    }
    const data = { total: 'unposted' }

    await expect(
      filterWritableFields(data, 'create', {
        ...onList(fieldConfigs),
        session: null,
        context: nonSudoContext(),
        inputData: {}, // omitted — applyCreateDefaults filled it
        defaultedFields: new Set(['total']),
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('still throws when the caller explicitly supplies an allowCreateDefault field, even if its value matches the default', async () => {
    const fieldConfigs = {
      emailVerified: checkbox({
        access: { create: () => false, update: () => false, allowCreateDefault: true },
      }),
    }
    const data = { emailVerified: false }

    await expect(
      filterWritableFields(data, 'create', {
        ...onList(fieldConfigs),
        session: null,
        context: nonSudoContext(),
        inputData: { emailVerified: false }, // the caller DID supply it
        defaultedFields: new Set(), // applyCreateDefaults did not fill it — it was already defined
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('does not exempt the field on update, even if defaultedFields somehow named it', async () => {
    const fieldConfigs = {
      emailVerified: checkbox({
        access: { create: () => false, update: () => false, allowCreateDefault: true },
      }),
    }
    const data = { emailVerified: true }

    await expect(
      filterWritableFields(data, 'update', {
        ...onList(fieldConfigs),
        session: null,
        context: nonSudoContext(),
        inputData: { emailVerified: true },
        defaultedFields: new Set(['emailVerified']),
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('is unaffected when defaultedFields is omitted entirely (existing callers)', async () => {
    const fieldConfigs = {
      emailVerified: checkbox({
        access: { create: () => false, update: () => false, allowCreateDefault: true },
      }),
    }
    const data = { emailVerified: false }

    await expect(
      filterWritableFields(data, 'create', {
        ...onList(fieldConfigs),
        session: null,
        context: nonSudoContext(),
        inputData: { emailVerified: false },
      }),
    ).rejects.toThrow(ValidationError)
  })
})

// ── #978: an undeclared key is refused even under sudo, a Synthetic
// back-relation included ──────────────────────────────────────────────────

describe('filterWritableFields — undeclared keys under sudo (#978)', () => {
  const config: OpenSaasConfig = {
    db: { provider: 'postgresql' },
    lists: {
      Account: { fields: { name: text() } },
      ChargeRequest: {
        fields: {
          kind: text(),
          account: relationship({ ref: 'Account' }),
        },
      },
    },
  }
  const args = { session: null, item: { id: 'a1' }, listName: 'Account', config }

  it.each([
    ['a Synthetic back-relation', 'from_ChargeRequest_account'],
    ['a genuinely unknown key', 'totallyBogusKey'],
  ])('throws on %s', async (_label, key) => {
    const data = { name: 'Acme', [key]: 'value' }

    await expect(
      filterWritableFields(data, 'update', {
        ...args,
        context: sudoContext(),
        inputData: data,
      }),
    ).rejects.toThrow(`"${key}": it is not a field of this list`)
  })
})

describe('the virtual-field write skip (issue #1531)', () => {
  it('skips a field flagged `virtual`, whose value never reaches the write', async () => {
    const fieldConfigs = {
      title: text(),
      summary: virtual({ type: 'string', hooks: { resolveOutput: () => '' } }),
    }
    const data = { title: 'Test', summary: 'ignored' }

    const filtered = await filterWritableFields(data, 'create', {
      ...onList(fieldConfigs),
      session: null,
      context: sudoContext(),
      inputData: data,
    })

    expect(filtered).toHaveProperty('title', 'Test')
    expect(filtered).not.toHaveProperty('summary')
  })

  it('skips a `{ kind: "computed" }` field with no `virtual` flag, the same as a flagged one', async () => {
    // A third-party field can declare the descriptor without the flag
    // (mirrors the read-path fixture in field-visibility.ts's own test) —
    // this has no column, so writing it through would hand the ORM a column
    // name that does not exist.
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Post: {
          fields: {
            title: text(),
            summary: {
              type: 'thirdPartyComputed',
              outputType: 'string',
              getContractField: () => ({ kind: 'computed' }),
            },
          },
        },
      },
    }
    const data = { title: 'Test', summary: 'ignored' }

    const filtered = await filterWritableFields(data, 'create', {
      session: null,
      context: sudoContext(),
      inputData: data,
      listName: 'Post',
      config,
    })

    expect(filtered).toHaveProperty('title', 'Test')
    expect(filtered).not.toHaveProperty('summary')
  })
})

describe('filterWritableFields — gates caller input, not hook output (issue #1643)', () => {
  const fieldConfigs = {
    name: text(),
    locked: text({ access: { create: () => false, update: () => false } }),
  }

  it('persists a write-denied field a hook set when the caller did not supply it', async () => {
    for (const operation of ['create', 'update'] as const) {
      const filtered = await filterWritableFields({ name: 'a', locked: 'server-set' }, operation, {
        ...onList(fieldConfigs),
        session: null,
        context: nonSudoContext(),
        inputData: { name: 'a' },
      })
      expect(filtered).toEqual({ name: 'a', locked: 'server-set' })
    }
  })

  it('throws when the caller supplies the denied field', async () => {
    await expect(
      filterWritableFields({ locked: 'x' }, 'create', {
        ...onList(fieldConfigs),
        session: null,
        context: nonSudoContext(),
        inputData: { locked: 'x' },
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('throws when the caller supplied the denied field and a hook removed it', async () => {
    await expect(
      filterWritableFields({ name: 'a' }, 'update', {
        ...onList(fieldConfigs),
        session: null,
        context: nonSudoContext(),
        inputData: { name: 'a', locked: 'x' },
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('refuses a caller-supplied foreign key but persists a hook-set one', async () => {
    const rels = {
      author: relationship({ ref: 'User.posts', access: { create: () => false } }),
    }
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        User: { fields: { posts: relationship({ ref: 'Post.author', many: true }) } },
        Post: { fields: rels },
      },
    }
    const base = { session: null, context: nonSudoContext(), listName: 'Post', config }
    await expect(
      filterWritableFields({ authorId: 'u1' }, 'create', {
        ...base,
        inputData: { authorId: 'u1' },
      }),
    ).rejects.toThrow(ValidationError)
    await expect(
      filterWritableFields({ authorId: 'u1' }, 'create', { ...base, inputData: {} }),
    ).resolves.toEqual({ authorId: 'u1' })
  })

  it("gates a foreign-key column by its owning field's access as it stands at each write", async () => {
    const author = relationship({ ref: 'User.posts', access: { create: () => true } })
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        User: { fields: { posts: relationship({ ref: 'Post.author', many: true }) } },
        Post: { fields: { author } },
      },
    }
    const write = () =>
      filterWritableFields({ authorId: 'u1' }, 'create', {
        session: null,
        context: nonSudoContext(),
        listName: 'Post',
        config,
        inputData: { authorId: 'u1' },
      })

    await expect(write()).resolves.toEqual({ authorId: 'u1' })
    author.access = { create: () => false }
    await expect(write()).rejects.toThrow(ValidationError)
  })
})

describe('a rule that catches the poison on `item`', () => {
  const swallows = ({ item }: { item?: Record<string, unknown> }): boolean => {
    try {
      return item?.ownerId !== 'x'
    } catch {
      return true
    }
  }

  it('is row-dependent for a read', async () => {
    await expect(
      classifyRowIndependentRead({ read: swallows }, { session: null, context: nonSudoContext() }),
    ).resolves.toBe('row-dependent')
  })

  it('is row-dependent for a write', async () => {
    await expect(
      classifyRowIndependentWrite({ update: swallows }, 'update', {
        session: null,
        context: nonSudoContext(),
      }),
    ).resolves.toBe('row-dependent')
  })

  it('is row-dependent for a create rule', async () => {
    await expect(
      classifyRowIndependentCreateAccess(swallows, { session: null, context: nonSudoContext() }),
    ).resolves.toBe('row-dependent')
  })

  it('a non-boolean answer after the touch stays the loud failure it is', async () => {
    const answersAFilter = (({ item }: { item: Record<string, unknown> }) => {
      try {
        void item.ownerId
      } catch {
        return { ownerId: { equals: 'x' } }
      }
      return true
    }) as unknown as NonNullable<FieldAccess['read']>

    await expect(
      classifyRowIndependentRead(
        { read: answersAFilter },
        { session: null, context: nonSudoContext() },
      ),
    ).rejects.toBeInstanceOf(InvalidFieldAccessResultError)
  })

  it('a rule that never touches `item` still answers', async () => {
    await expect(
      classifyRowIndependentRead(
        { read: () => false },
        { session: null, context: nonSudoContext() },
      ),
    ).resolves.toBe('deny')
  })
})

describe('checkRowRead on a rule that structuredClones a nested value', () => {
  const fieldConfigs = { meta: text(), notes: relationship({ ref: 'Note.ticket', many: true }) }
  const rule: FieldAccess = {
    read: ({ item }) => (structuredClone(item?.meta) as { public?: boolean })?.public === true,
  }

  it('denies instead of throwing', async () => {
    const row = ruleRowOf(
      { id: 't1', meta: { public: true }, notes: [] },
      NO_RULE_VIEWS,
      fieldConfigs,
      undefined,
      undefined,
    )
    await expect(
      checkRowRead(rule, { session: null, context: nonSudoContext() }, row),
    ).resolves.toBe(false)
  })
})
