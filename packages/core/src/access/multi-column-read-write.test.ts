import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest'
import { z } from 'zod'
import { filterReadableFields } from './field-visibility.js'
import {
  executeFieldResolveInputHooks,
  splitMultiColumnFields,
  ValidationError,
} from '../hooks/index.js'
import { json, text } from '../fields/index.js'
import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import { createTestDatabase, ormClientFor, type TestDatabase } from '../testing/context.js'
import {
  writePluginOwnedField,
  HandlelessPluginFieldWriteError,
  UnknownPluginFieldWriteError,
  UndefinedPluginFieldWriteError,
} from '../context/plugin-field-write.js'
import type { AccessContext, FieldAccess } from './types.js'

/**
 * Generic core wiring for multi-column fields (the contract storage
 * image()/file() use in Keystone-parity mode — see ADR-0006). These tests are
 * field-agnostic: they assert that ANY field implementing
 * getColumnNames/assembleColumns/splitColumns is assembled on read (raw columns
 * stripped) and split on write.
 *
 * The write side is split across two phases (#789): `executeFieldResolveInputHooks`
 * (Phase 1.5) resolves the field's value under its LOGICAL key only — no split —
 * so that validation (Phase 2-3, not exercised by these field-agnostic unit
 * tests; see the Hook Pipeline / Write Pipeline test suites) runs against the
 * logical value first. `splitMultiColumnFields` (Phase 4) then replaces the
 * logical key with its physical per-part columns, AFTER validation has passed.
 */

// A minimal multi-column field: two physical columns `m_url` and `m_size`
// assembled into `{ url, size }` and split back. Optionally carries field-level
// access so we can lock the write-access gate around the split.
function multiColumnField(access?: FieldAccess): FieldConfig {
  const COLUMNS = ['m_url', 'm_size']
  return {
    type: 'multiColumn',
    access,
    getColumnNames: () => COLUMNS,
    assembleColumns: (_fieldName: string, row: Record<string, unknown>) => {
      const url = row.m_url
      if (url === null || url === undefined || url === '') return null
      return { url, size: row.m_size ?? 0 }
    },
    splitColumns: (_fieldName: string, value: unknown) => {
      if (value === null || value === undefined) {
        return { m_url: null, m_size: null }
      }
      const v = value as { url?: unknown; size?: unknown }
      return { m_url: v.url ?? null, m_size: v.size ?? null }
    },
    // Field's own resolveInput is identity here (the value is authoritative).
    hooks: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic test hook
      resolveInput: async ({ resolvedData, fieldKey }: any) => resolvedData?.[fieldKey],
    },
  } as unknown as FieldConfig
}

function makeContext(overrides: { isSudo?: boolean } = {}): AccessContext {
  return {
    session: null,
    _isSudo: overrides.isSudo ?? false,
    _resolveOutputChain: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal context for unit test
  } as any
}

describe('multi-column read assembly (filterReadableFields)', () => {
  const fields = { media: multiColumnField() }

  it('assembles the per-part columns into the logical field and strips the raw columns', async () => {
    const row = { id: 'a', m_url: 'https://x/y.jpg', m_size: 99, title: 'hi' }
    const result = await filterReadableFields(
      row,
      // title is a plain field
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inline field configs
      { ...fields, title: { type: 'text' } as any },
      { session: null, context: makeContext() },
      undefined,
      0,
      'Post',
    )
    expect(result).toEqual({ id: 'a', title: 'hi', media: { url: 'https://x/y.jpg', size: 99 } })
    // Raw columns must NOT leak.
    expect('m_url' in result).toBe(false)
    expect('m_size' in result).toBe(false)
  })

  it('assembles a partially-populated row (only m_url present)', async () => {
    const row = { id: 'b', m_url: 'https://x/only.jpg' }
    const result = await filterReadableFields(
      row,
      fields,
      { session: null, context: makeContext() },
      undefined,
      0,
      'Post',
    )
    expect(result).toEqual({ id: 'b', media: { url: 'https://x/only.jpg', size: 0 } })
  })

  it('yields a null logical value when the columns are empty', async () => {
    const row = { id: 'c', m_url: null, m_size: null }
    const result = await filterReadableFields(
      row,
      fields,
      { session: null, context: makeContext() },
      undefined,
      0,
      'Post',
    )
    expect(result).toEqual({ id: 'c', media: null })
  })

  it('leaves the field absent when its columns were not selected', async () => {
    const row = { id: 'd', title: 'no media columns' }
    const result = await filterReadableFields(
      row,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inline field configs
      { ...fields, title: { type: 'text' } as any },
      { session: null, context: makeContext() },
      undefined,
      0,
      'Post',
    )
    expect(result).toEqual({ id: 'd', title: 'no media columns' })
    expect('media' in result).toBe(false)
  })
})

describe('multi-column resolveInput (executeFieldResolveInputHooks) does NOT split (#789)', () => {
  const fields = { media: multiColumnField() }

  it('resolves the field under its LOGICAL key and leaves it unsplit', async () => {
    const inputData = { media: { url: 'https://x/y.jpg', size: 99 } }
    const result = await executeFieldResolveInputHooks(
      inputData,
      { ...inputData },
      fields,
      'create',
      makeContext(),
      'Post',
    )
    // Still under the logical key — no split, no per-part columns yet.
    expect(result).toEqual({ media: { url: 'https://x/y.jpg', size: 99 } })
    expect('m_url' in result).toBe(false)
    expect('m_size' in result).toBe(false)
  })

  it('passes an unrecognised value through unsplit, under the logical key', async () => {
    // The field's own resolveInput fallback (see fixture: "unknown → return as
    // is and let validation catch it") must be able to hand this value to
    // validation BEFORE any split happens.
    const inputData = { media: 'not-a-valid-shape' }
    const result = await executeFieldResolveInputHooks(
      inputData,
      { ...inputData },
      fields,
      'update',
      makeContext(),
      'Post',
    )
    expect(result).toEqual({ media: 'not-a-valid-shape' })
  })

  it('does not touch the field when it is absent from the write', async () => {
    const inputData = { title: 'no media in payload' }
    const result = await executeFieldResolveInputHooks(
      inputData,
      { ...inputData },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inline field configs
      { ...fields, title: { type: 'text' } as any },
      'update',
      makeContext(),
      'Post',
    )
    expect(result).toEqual({ title: 'no media in payload' })
    expect('media' in result).toBe(false)
  })
})

describe('multi-column write split (splitMultiColumnFields, AFTER validation — #789)', () => {
  const fields = { media: multiColumnField() }

  it('splits the logical value into per-part columns and removes the logical key', async () => {
    const inputData = { media: { url: 'https://x/y.jpg', size: 99 } }
    const result = await splitMultiColumnFields(
      inputData,
      { ...inputData },
      fields,
      'create',
      makeContext(),
    )
    expect(result).toEqual({ m_url: 'https://x/y.jpg', m_size: 99 })
    expect('media' in result).toBe(false)
  })

  it('splitting null clears all per-part columns', async () => {
    const inputData = { media: null }
    const result = await splitMultiColumnFields(
      inputData,
      { ...inputData },
      fields,
      'update',
      makeContext(),
    )
    expect(result).toEqual({ m_url: null, m_size: null })
  })

  it('does not touch the columns when the logical field is absent from the write', async () => {
    const inputData = { title: 'no media in payload' }
    const result = await splitMultiColumnFields(
      inputData,
      { ...inputData },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inline field configs
      { ...fields, title: { type: 'text' } as any },
      'update',
      makeContext(),
    )
    expect(result).toEqual({ title: 'no media in payload' })
    expect('m_url' in result).toBe(false)
  })
})

/**
 * The same write-access gate, driven through `context.db` rather than through
 * `splitMultiColumnFields` alone — the surface an application calls. The field
 * below carries a contract, so its two columns are real ones and a granted
 * write is asserted by reading the value back rather than by inspecting what
 * the split returned.
 */
function storedMultiColumn(access?: FieldAccess, validated = false): FieldConfig {
  const field = json()
  const columns = ['avatar_filename', 'avatar_filesize']
  field.access = access
  if (validated) {
    // Mirrors the storage `image()`/`file()` contract: null/undefined and an
    // already-shaped value pass through, anything else is returned as-is for
    // validation to catch (#789). The schema is what has to see the LOGICAL
    // value, before the split turns it into two nulls.
    field.getZodSchema = () =>
      z.object({ filename: z.string(), filesize: z.number() }).nullable().optional()
    field.hooks = {
      resolveInput: ({ resolvedData, fieldKey }) => resolvedData[fieldKey],
    }
  }
  field.getContractField = () => ({
    kind: 'columns',
    columns: [
      { name: columns[0], type: { pack: 'pg', type: 'text' }, nullable: true },
      { name: columns[1], type: { pack: 'pg', type: 'int' }, nullable: true },
    ],
  })
  field.getColumnNames = () => columns
  field.assembleColumns = (_fieldName, row) => {
    const filename = row[columns[0]]
    if (filename === null || filename === undefined) return null
    return { filename, filesize: row[columns[1]] }
  }
  field.splitColumns = (_fieldName, value) => {
    if (value === null || value === undefined) return { [columns[0]]: null, [columns[1]]: null }
    const metadata: { filename?: unknown; filesize?: unknown } = value
    return {
      [columns[0]]: metadata.filename ?? null,
      [columns[1]]: metadata.filesize ?? null,
    }
  }
  return field
}

const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

const storedConfig: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    NoUpdate: {
      fields: { avatar: storedMultiColumn({ update: () => false }) },
      access: { operation: OPEN },
    },
    NoCreate: {
      fields: { avatar: storedMultiColumn({ create: () => false }) },
      access: { operation: OPEN },
    },
    Granted: {
      fields: { avatar: storedMultiColumn({ create: () => true, update: () => true }) },
      access: { operation: OPEN },
    },
    Ungated: {
      fields: { avatar: storedMultiColumn() },
      access: { operation: OPEN },
    },
    Validated: {
      fields: { avatar: storedMultiColumn(undefined, true) },
      access: { operation: OPEN },
    },
    // A list shaped like one a plugin writes into: a column denied to
    // application code, beside a field the list's own resolveInput derives
    // from other input, unguarded — the pattern the root CLAUDE.md documents.
    Owned: {
      fields: {
        title: text(),
        label: text(),
        avatar: storedMultiColumn({ update: () => false }),
      },
      hooks: {
        resolveInput: ({ resolvedData }) => ({
          ...resolvedData,
          label: `label:${String(resolvedData.title)}`,
        }),
        afterOperation: async () => {
          ownedAfterOperations.push('after')
        },
      },
      access: { operation: OPEN },
    },
  },
}

/** One entry per list-level `afterOperation` the `Owned` list fires. */
const ownedAfterOperations: string[] = []

const media = { filename: 'ada.png', filesize: 99 }

describe('multi-column write access through context.db', () => {
  const BOOT = 120_000
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase(storedConfig)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
  })

  it(
    'THROWS when update access is denied, and the columns keep what they had',
    async () => {
      const context = database.context(null)
      const created = await context.db.NoUpdate.create({ data: { avatar: media } })
      const id = created?.id
      if (typeof id !== 'string') throw new Error('the create returned no row')

      await expect(
        context.db.NoUpdate.update({ where: { id }, data: { avatar: { filename: 'other' } } }),
      ).rejects.toThrow('Cannot update "avatar": field-level access denied.')

      const stored = await context.db.NoUpdate.where({}).first()
      expect(stored?.avatar).toEqual(media)
    },
    BOOT,
  )

  it(
    'THROWS when create access is denied, and no row lands',
    async () => {
      const context = database.context(null)

      await expect(context.db.NoCreate.create({ data: { avatar: media } })).rejects.toThrow(
        'Cannot create "avatar": field-level access denied.',
      )

      expect(await context.db.NoCreate.where({}).first()).toBeNull()
    },
    BOOT,
  )

  it(
    'writes both per-part columns when access is granted',
    async () => {
      const context = database.context(null)
      await context.db.Granted.create({ data: { avatar: media } })

      const stored = await context.db.Granted.where({}).first()
      expect(stored?.avatar).toEqual(media)
      expect(stored).not.toHaveProperty('avatar_filename')
    },
    BOOT,
  )

  it(
    'sudo bypasses the gate and the columns land',
    async () => {
      const context = database.context(null)
      const created = await context.db.NoUpdate.create({ data: { avatar: media } })
      const id = created?.id
      if (typeof id !== 'string') throw new Error('the create returned no row')

      await context.sudo().db.NoUpdate.update({
        where: { id },
        data: { avatar: { filename: 'other', filesize: 7 } },
      })

      const stored = await context.db.NoUpdate.where({}).first()
      expect(stored?.avatar).toEqual({ filename: 'other', filesize: 7 })
    },
    BOOT,
  )

  it(
    'a field WITHOUT field-level access writes exactly as before',
    async () => {
      const context = database.context(null)
      await context.db.Ungated.create({ data: { avatar: media } })

      expect((await context.db.Ungated.where({}).first())?.avatar).toEqual(media)
    },
    BOOT,
  )

  it(
    'clearing the field with null clears both columns',
    async () => {
      const context = database.context(null)
      const created = await context.db.Granted.create({ data: { avatar: media } })
      const id = created?.id
      if (typeof id !== 'string') throw new Error('the create returned no row')

      await context.db.Granted.update({ where: { id }, data: { avatar: null } })

      expect((await context.db.Granted.where({}).first())?.avatar).toBeNull()
    },
    BOOT,
  )

  /**
   * #789: the field's `resolveInput` hands an unrecognised value straight
   * through for validation to catch. Validation therefore has to see the
   * LOGICAL value — if the split ran first, the value would already be two
   * nulls and the write would succeed, storing nothing.
   */
  describe('validation runs before the split', () => {
    it(
      'create: an unrecognised value throws and no row lands',
      async () => {
        const context = database.context(null)

        await expect(
          context.db.Validated.create({ data: { avatar: 'not-a-valid-shape' } }),
        ).rejects.toBeInstanceOf(ValidationError)

        expect(await context.db.Validated.where({}).first()).toBeNull()
      },
      BOOT,
    )

    it(
      'update: an unrecognised value throws and the columns keep what they had',
      async () => {
        const context = database.context(null)
        const created = await context.db.Validated.create({ data: { avatar: media } })
        const id = created?.id
        if (typeof id !== 'string') throw new Error('the create returned no row')

        await expect(
          context.db.Validated.update({ where: { id }, data: { avatar: 'not-a-valid-shape' } }),
        ).rejects.toBeInstanceOf(ValidationError)

        expect((await context.db.Validated.where({}).first())?.avatar).toEqual(media)
      },
      BOOT,
    )

    it(
      'a recognised value and null both still pass and reach the columns',
      async () => {
        const context = database.context(null)
        const created = await context.db.Validated.create({ data: { avatar: media } })
        const id = created?.id
        if (typeof id !== 'string') throw new Error('the create returned no row')
        expect((await context.db.Validated.where({}).first())?.avatar).toEqual(media)

        await context.db.Validated.update({ where: { id }, data: { avatar: null } })
        expect((await context.db.Validated.where({}).first())?.avatar).toBeNull()
      },
      BOOT,
    )
  })
})

describe('writePluginOwnedField (ADR-0066)', () => {
  const BOOT = 120_000
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase(storedConfig)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
    ownedAfterOperations.length = 0
  })

  /** The AccessContext core hands `Plugin.runtime`, over this database. */
  function internalContext(): AccessContext {
    const stack = database.context(null)
    const internal: AccessContext = {
      session: null,
      ormHandle: ormClientFor(database.data, database.client.orm),
      db: stack.db,
      storage: stack.storage,
      plugins: stack.plugins,
      _isSudo: false,
      _resolveOutputChain: [],
      _config: storedConfig,
    }
    return internal
  }

  async function seed(): Promise<string> {
    const created = await database.context(null).db.Owned.create({ data: { title: 'ada' } })
    const id = created?.id
    if (typeof id !== 'string') throw new Error('the create returned no row')
    return id
  }

  it(
    'writes the field\u2019s own columns past its write denial',
    async () => {
      const id = await seed()

      await writePluginOwnedField({
        context: internalContext(),
        listName: 'Owned',
        id,
        fieldName: 'avatar',
        value: media,
      })

      const stored = await database.context(null).db.Owned.where({}).first()
      expect(stored?.avatar).toEqual(media)
    },
    BOOT,
  )

  it(
    'leaves a derived field the list\u2019s resolveInput owns untouched',
    async () => {
      const id = await seed()

      await writePluginOwnedField({
        context: internalContext(),
        listName: 'Owned',
        id,
        fieldName: 'avatar',
        value: media,
      })

      // Re-running that resolveInput over a payload naming only `avatar` would
      // rewrite this as `label:undefined`.
      const stored = await database.context(null).db.Owned.where({}).first()
      expect(stored?.label).toBe('label:ada')
      expect(stored?.title).toBe('ada')
    },
    BOOT,
  )

  it(
    'fires no list hook of its own',
    async () => {
      const id = await seed()
      expect(ownedAfterOperations).toEqual(['after'])

      await writePluginOwnedField({
        context: internalContext(),
        listName: 'Owned',
        id,
        fieldName: 'avatar',
        value: media,
      })

      expect(ownedAfterOperations).toEqual(['after'])
    },
    BOOT,
  )

  it(
    'clearing with null clears every column the field owns',
    async () => {
      const id = await seed()
      const context = internalContext()
      const write = (value: unknown): Promise<void> =>
        writePluginOwnedField({
          context,
          listName: 'Owned',
          id,
          fieldName: 'avatar',
          value,
        })

      await write(media)
      await write(null)

      expect((await database.context(null).db.Owned.where({}).first())?.avatar).toBeNull()
    },
    BOOT,
  )

  it(
    'a row that is gone is a silent no-op',
    async () => {
      await expect(
        writePluginOwnedField({
          context: internalContext(),
          listName: 'Owned',
          id: '00000000-0000-7000-8000-000000000000',
          fieldName: 'avatar',
          value: media,
        }),
      ).resolves.toBeUndefined()
    },
    BOOT,
  )

  it('refuses the returned StackContext, which carries no ORM handle', async () => {
    await expect(
      writePluginOwnedField({
        context: database.context(null) as unknown as AccessContext,
        listName: 'Owned',
        id: 'any',
        fieldName: 'avatar',
        value: media,
      }),
    ).rejects.toBeInstanceOf(HandlelessPluginFieldWriteError)
  })

  it(
    'takes the column layout from the config, so a single-column field writes one column',
    async () => {
      const id = await seed()

      await writePluginOwnedField({
        context: internalContext(),
        listName: 'Owned',
        id,
        fieldName: 'label',
        value: 'label:written',
      })

      const stored = await database.context(null).db.Owned.where({}).first()
      expect(stored?.label).toBe('label:written')
      expect(stored?.avatar).toBeNull()
    },
    BOOT,
  )

  it(
    'refuses a field the list does not declare, and writes nothing',
    async () => {
      const id = await seed()

      await expect(
        writePluginOwnedField({
          context: internalContext(),
          listName: 'Owned',
          id,
          fieldName: 'nowhere',
          value: 'PWNED',
        }),
      ).rejects.toThrow('list "Owned" declares no field "nowhere"')

      const stored = await database.context(null).db.Owned.where({}).first()
      expect(stored?.label).toBe('label:ada')
      expect(stored?.title).toBe('ada')
    },
    BOOT,
  )

  it.each(['constructor', 'toString', '__proto__'])(
    'refuses %s, a field name the list inherits rather than declares',
    async (fieldName) => {
      // A bare `list.fields[fieldName]` answers for every Object.prototype key,
      // so the lookup returns a value that is not undefined, carries no
      // splitColumns, and falls back to writing a column of that name.
      const id = await seed()

      const write = writePluginOwnedField({
        context: internalContext(),
        listName: 'Owned',
        id,
        fieldName,
        value: 'PWNED',
      })

      await expect(write).rejects.toBeInstanceOf(UnknownPluginFieldWriteError)
      await expect(write).rejects.toThrow(`list "Owned" declares no field "${fieldName}"`)
      // The name is what routes it to a consumer's standing-defect arm.
      await expect(write).rejects.toHaveProperty('name', 'UnknownPluginFieldWriteError')

      const stored = await database.context(null).db.Owned.where({}).first()
      expect(stored?.label).toBe('label:ada')
      expect(stored?.title).toBe('ada')
      expect(stored?.avatar).toBeNull()
    },
    BOOT,
  )

  it.each(['constructor', 'toString', '__proto__'])(
    'refuses %s, a list name the config inherits rather than declares',
    async (listName) => {
      // Unguarded this throws a bare TypeError reaching into the inherited
      // value's `fields`, whose name is not one a consumer classifies as a
      // refusal — so the wiring defect is reported as retryable.
      const write = writePluginOwnedField({
        context: internalContext(),
        listName,
        id: await seed(),
        fieldName: 'avatar',
        value: media,
      })

      await expect(write).rejects.toBeInstanceOf(UnknownPluginFieldWriteError)
      await expect(write).rejects.toThrow(`the config declares no list "${listName}"`)
      await expect(write).rejects.toHaveProperty('name', 'UnknownPluginFieldWriteError')
    },
    BOOT,
  )

  it(
    'refuses a list the config does not declare',
    async () => {
      await expect(
        writePluginOwnedField({
          context: internalContext(),
          listName: 'Nowhere',
          id: await seed(),
          fieldName: 'avatar',
          value: media,
        }),
      ).rejects.toThrow('the config declares no list "Nowhere"')
    },
    BOOT,
  )

  it(
    'refuses a context carrying no config, which cannot vouch for the field',
    async () => {
      const context: AccessContext = { ...internalContext(), _config: undefined }

      await expect(
        writePluginOwnedField({
          context,
          listName: 'Owned',
          id: await seed(),
          fieldName: 'avatar',
          value: media,
        }),
      ).rejects.toBeInstanceOf(UnknownPluginFieldWriteError)
    },
    BOOT,
  )

  it(
    'refuses undefined by name rather than wiping the field with it',
    async () => {
      const id = await seed()
      const context = internalContext()

      await writePluginOwnedField({
        context,
        listName: 'Owned',
        id,
        fieldName: 'avatar',
        value: media,
      })

      await expect(
        writePluginOwnedField({
          context,
          listName: 'Owned',
          id,
          fieldName: 'avatar',
          value: undefined,
        }),
      ).rejects.toBeInstanceOf(UndefinedPluginFieldWriteError)

      expect((await database.context(null).db.Owned.where({}).first())?.avatar).toEqual(media)
    },
    BOOT,
  )
})

describe('multi-column write split respects field-level write access', () => {
  it('THROWS when update access is denied, exactly as filterWritableFields does', async () => {
    const fields = { media: multiColumnField({ update: () => false }) }
    const inputData = { media: { url: 'https://x/y.jpg', size: 99 } }
    await expect(
      splitMultiColumnFields(inputData, { ...inputData }, fields, 'update', makeContext()),
    ).rejects.toThrow('Cannot update "media": field-level access denied.')
  })

  it('THROWS when create access is denied', async () => {
    const fields = { media: multiColumnField({ create: () => false }) }
    const inputData = { media: { url: 'https://x/y.jpg', size: 99 } }
    await expect(
      splitMultiColumnFields(inputData, { ...inputData }, fields, 'create', makeContext()),
    ).rejects.toThrow('Cannot create "media": field-level access denied.')
  })

  it('still splits/writes the columns when write access is granted', async () => {
    const fields = { media: multiColumnField({ update: () => true, create: () => true }) }
    const inputData = { media: { url: 'https://x/y.jpg', size: 99 } }
    const result = await splitMultiColumnFields(
      inputData,
      { ...inputData },
      fields,
      'update',
      makeContext(),
    )
    expect(result).toEqual({ m_url: 'https://x/y.jpg', m_size: 99 })
    expect('media' in result).toBe(false)
  })

  it('denying the OTHER operation does not block the write (update field, create op)', async () => {
    // A field that denies `update` must still be writable on `create`.
    const fields = { media: multiColumnField({ update: () => false }) }
    const inputData = { media: { url: 'https://x/y.jpg', size: 99 } }
    const result = await splitMultiColumnFields(
      inputData,
      { ...inputData },
      fields,
      'create',
      makeContext(),
    )
    expect(result).toEqual({ m_url: 'https://x/y.jpg', m_size: 99 })
  })

  it('sudo bypasses the field-access gate and still splits', async () => {
    const fields = { media: multiColumnField({ update: () => false }) }
    const inputData = { media: { url: 'https://x/y.jpg', size: 99 } }
    const result = await splitMultiColumnFields(
      inputData,
      { ...inputData },
      fields,
      'update',
      makeContext({ isSudo: true }),
    )
    expect(result).toEqual({ m_url: 'https://x/y.jpg', m_size: 99 })
  })

  it('a multi-column field WITHOUT field-level access splits exactly as before', async () => {
    const fields = { media: multiColumnField() }
    const inputData = { media: { url: 'https://x/y.jpg', size: 99 } }
    const result = await splitMultiColumnFields(
      inputData,
      { ...inputData },
      fields,
      'update',
      makeContext(),
    )
    expect(result).toEqual({ m_url: 'https://x/y.jpg', m_size: 99 })
  })
})
