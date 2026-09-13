// What `image()`/`file()` promise against a real schema (issue #1310): a
// single-Json? column by default, and — in `db.columns: 'keystone'`
// (multi-column) mode — a logical value split across physical columns on
// write and assembled back on read, with field-level access gating the
// logical key rather than the columns underneath it. Every upload here goes
// through `context.db`, so the metadata under assertion is the field's own
// hook output, not a value the test hands it directly.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { localStorage } from '../src/config/index.js'
import { image, file } from '../src/fields/index.js'
import { createStorageUtils } from '../src/runtime/index.js'
import type { FileMetadata, ImageMetadata } from '../src/config/types.js'

const BOOT = 120_000

/** Narrows away the silent-denial `null` every secured read and write can return. */
function present<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`${what} returned null — denied, or not found`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The untyped Test context hands back an unknown `id`; every `where` needs a string. */
function idOf(row: unknown): string {
  const id = isRecord(row) ? row.id : undefined
  if (typeof id !== 'string') throw new Error('expected a string id')
  return id
}

/** A 1x1 PNG — small, and a real image, so `getImageDimensions` has something to read. */
const PNG_BYTES = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xff, 0xff, 0x3f,
  0x03, 0x00, 0x08, 0xfc, 0x02, 0xfe, 0xa7, 0x35, 0x81, 0x84, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]

function pngFile(name: string): File {
  return new File([new Uint8Array(PNG_BYTES)], name, { type: 'image/png' })
}

function pdfFile(name: string): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' })
}

let uploadDir: string

const OPEN = { query: () => true, create: () => true, update: () => true }

function buildConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    storage: { files: localStorage({ uploadDir, serveUrl: '/uploads' }) },
    lists: {
      // Default single-Json? backing.
      Doc: {
        fields: {
          avatar: image({ storage: 'files' }),
          attachment: file({ storage: 'files' }),
        },
        access: { operation: OPEN },
      },
      // Multi-column (Keystone-parity) backing: the path with the most room
      // to go wrong (ADR-0006).
      Legacy: {
        fields: {
          avatar: image({ storage: 'files', db: { columns: 'keystone' } }),
          attachment: file({ storage: 'files', db: { columns: 'keystone' } }),
        },
        access: { operation: OPEN },
      },
      // A multi-column field the logical key denies writes to.
      Locked: {
        fields: {
          avatar: image({
            storage: 'files',
            db: { columns: 'keystone' },
            access: { update: () => false },
          }),
        },
        access: { operation: OPEN },
      },
    },
  }
}

describe('image()/file() against a real column (Test context)', () => {
  let harness: TestContext
  let config: OpenSaasConfig

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'opensaas-storage-test-'))
    config = buildConfig()
    harness = await createTestContext(config, null, { storage: createStorageUtils(config) })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
    await rm(uploadDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await harness.truncate()
  })

  /**
   * The raw row, reached through the (already-marked) Unsafe surface rather
   * than `context.db` — the only way to see the physical per-part columns a
   * multi-column field's logical key never exposes.
   */
  async function rawRow(model: string, id: string): Promise<Record<string, unknown>> {
    const orm: unknown = harness.context.unsafe.orm
    const namespace: unknown = isRecord(orm) ? orm.public : undefined
    const collection: unknown = isRecord(namespace) ? namespace[model] : undefined
    if (!isRecord(collection) || typeof collection.where !== 'function') {
      throw new Error(`no collection "${model}" on the Unsafe surface`)
    }
    const builder: unknown = collection.where.call(collection, { id })
    if (!isRecord(builder) || typeof builder.first !== 'function') {
      throw new Error(`collection "${model}" where() carries no first()`)
    }
    const row: unknown = await builder.first.call(builder)
    if (!isRecord(row)) throw new Error(`no raw row for "${model}" id ${id}`)
    return row
  }

  describe('single-column (default) mode', () => {
    it('uploads an image and reads its metadata back through one jsonb column', async () => {
      const created = present(
        await harness.context.db.Doc.create({ data: { avatar: pngFile('a.png') } }),
        'Doc.create',
      )
      const stored = present(created.avatar, 'Doc.avatar') as ImageMetadata
      expect(stored.mimeType).toBe('image/png')
      expect(stored.width).toBe(1)
      expect(stored.height).toBe(1)

      const read = present(
        await harness.context.db.Doc.where({ id: { equals: idOf(created) } }).first(),
        'Doc read',
      )
      expect(read.avatar).toEqual(stored)

      // Backed by a single column under the field's own name.
      const raw = await rawRow('Doc', idOf(created))
      expect(raw.avatar).toEqual(stored)
    })

    it('uploads a file and reads its metadata back', async () => {
      const created = present(
        await harness.context.db.Doc.create({ data: { attachment: pdfFile('a.pdf') } }),
        'Doc.create',
      )
      const stored = present(created.attachment, 'Doc.attachment') as FileMetadata
      expect(stored.mimeType).toBe('application/pdf')

      const read = present(
        await harness.context.db.Doc.where({ id: { equals: idOf(created) } }).first(),
        'Doc read',
      )
      expect(read.attachment).toEqual(stored)
    })

    it('leaves an unwritten field null', async () => {
      const created = present(await harness.context.db.Doc.create({ data: {} }), 'Doc.create')
      expect(created.avatar).toBeNull()
      expect(created.attachment).toBeNull()
    })
  })

  describe('multi-column (keystone) mode: split on write, assembled on read', () => {
    it('splits an uploaded image into its physical columns', async () => {
      const created = present(
        await harness.context.db.Legacy.create({ data: { avatar: pngFile('b.png') } }),
        'Legacy.create',
      )
      const stored = present(created.avatar, 'Legacy.avatar') as ImageMetadata

      // The write split the logical value: the raw row carries the per-part
      // physical columns, and no `avatar` column at all.
      const raw = await rawRow('Legacy', idOf(created))
      expect('avatar' in raw).toBe(false)
      expect(raw.avatar_url).toBe(stored.url)
      expect(raw.avatar_width).toBe(1)
      expect(raw.avatar_height).toBe(1)
      expect(raw.avatar_filesize).toBe(stored.size)
      expect(raw.avatar_contentType).toBe('image/png')

      // The secured read assembled the same physical columns back into one value.
      const read = present(
        await harness.context.db.Legacy.where({ id: { equals: idOf(created) } }).first(),
        'Legacy read',
      )
      expect(read.avatar).toEqual(stored)
    })

    it('splits an uploaded file into its physical columns', async () => {
      const created = present(
        await harness.context.db.Legacy.create({ data: { attachment: pdfFile('b.pdf') } }),
        'Legacy.create',
      )
      const stored = present(created.attachment, 'Legacy.attachment') as FileMetadata

      const raw = await rawRow('Legacy', idOf(created))
      expect('attachment' in raw).toBe(false)
      expect(raw.attachment_filename).toBe(stored.filename)
      expect(raw.attachment_url).toBe(stored.url)
      expect(raw.attachment_filesize).toBe(stored.size)

      const read = present(
        await harness.context.db.Legacy.where({ id: { equals: idOf(created) } }).first(),
        'Legacy read',
      )
      expect(read.attachment).toEqual(stored)
    })

    it('a row with no upload assembles to null from all-NULL columns', async () => {
      const created = present(await harness.context.db.Legacy.create({ data: {} }), 'Legacy.create')
      expect(created.avatar).toBeNull()
      expect(created.attachment).toBeNull()

      const raw = await rawRow('Legacy', idOf(created))
      expect(raw.avatar_url).toBeNull()
      expect(raw.avatar_width).toBeNull()
    })

    it('clearing the field with null clears every physical column', async () => {
      const created = present(
        await harness.context.db.Legacy.create({ data: { avatar: pngFile('c.png') } }),
        'Legacy.create',
      )

      const cleared = present(
        await harness.context.db.Legacy.update({
          where: { id: idOf(created) },
          data: { avatar: null },
        }),
        'Legacy.update',
      )
      expect(cleared.avatar).toBeNull()

      const raw = await rawRow('Legacy', idOf(created))
      expect(raw.avatar_url).toBeNull()
      expect(raw.avatar_width).toBeNull()
      expect(raw.avatar_height).toBeNull()
      expect(raw.avatar_filesize).toBeNull()
      expect(raw.avatar_contentType).toBeNull()
    })
  })

  describe('field-level access on the logical key (multi-column)', () => {
    it('THROWS on a denied update, and the stored columns keep what they had', async () => {
      const created = present(
        await harness.context.db.Locked.create({ data: { avatar: pngFile('d.png') } }),
        'Locked.create',
      )
      const stored = present(created.avatar, 'Locked.avatar') as ImageMetadata

      await expect(
        harness.context.db.Locked.update({
          where: { id: idOf(created) },
          data: { avatar: pngFile('replacement.png') },
        }),
      ).rejects.toThrow('Cannot update "avatar": field-level access denied.')

      const read = present(
        await harness.context.db.Locked.where({ id: { equals: idOf(created) } }).first(),
        'Locked read',
      )
      expect(read.avatar).toEqual(stored)
    })

    it('a sudo write bypasses the denial and the columns land', async () => {
      const created = present(
        await harness.context.db.Locked.create({ data: { avatar: pngFile('e.png') } }),
        'Locked.create',
      )
      const original = present(created.avatar, 'Locked.avatar') as ImageMetadata

      const updated = present(
        await harness.context
          .sudo()
          .db.Locked.update({ where: { id: idOf(created) }, data: { avatar: pngFile('f.png') } }),
        'sudo update',
      )
      const stored = present(updated.avatar, 'Locked.avatar') as ImageMetadata
      expect(stored.url).not.toBe(original.url)

      const read = present(
        await harness.context.db.Locked.where({ id: { equals: idOf(created) } }).first(),
        'Locked read',
      )
      expect(read.avatar).toEqual(stored)
    })
  })
})
