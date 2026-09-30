// A metadata-shaped `file()`/`image()` write is AUTHORITATIVE (ADR-0006's
// no-re-upload guarantee), so it must be trusted only when it is genuinely
// the row's own currently stored value, or the write is sudo — never
// caller-authored as-is. Issue #1619: without this, any session with
// create/update access could store `{ filename: '../../victim.txt', ... }`
// verbatim, and cleanup would then delete whatever that value names, through
// whatever provider it names — arbitrary file deletion and cross-row deletion.
// These tests exercise the real pipeline (Test context, real LocalStorageProvider)
// rather than calling field hooks directly, so a passing test here is a
// passing real write, not just a passing mock.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

function idOf(row: unknown): string {
  const id = isRecord(row) ? row.id : undefined
  if (typeof id !== 'string') throw new Error('expected a string id')
  return id
}

function pdfFile(name: string): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' })
}

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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

let uploadDir: string
let otherUploadDir: string

const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

function buildConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    storage: {
      files: localStorage({ uploadDir, serveUrl: '/uploads' }),
      other: localStorage({ uploadDir: otherUploadDir, serveUrl: '/other' }),
    },
    lists: {
      Doc: {
        fields: {
          avatar: image({ storage: 'files', cleanupOnDelete: true, cleanupOnReplace: true }),
          attachment: file({ storage: 'files', cleanupOnDelete: true, cleanupOnReplace: true }),
        },
        access: { operation: OPEN },
      },
    },
  }
}

describe('image()/file() metadata trust and cleanup provider (issue #1619)', () => {
  let harness: TestContext
  let config: OpenSaasConfig

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'opensaas-storage-trust-'))
    otherUploadDir = await mkdtemp(join(tmpdir(), 'opensaas-storage-trust-other-'))
    config = buildConfig()
    harness = await createTestContext(config, null, { storage: createStorageUtils(config) })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
    await rm(uploadDir, { recursive: true, force: true })
    await rm(otherUploadDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await harness.truncate()
  })

  describe('create', () => {
    it('refuses a metadata-shaped value from a non-privileged session, and writes nothing', async () => {
      const metadata: FileMetadata = {
        filename: 'x.pdf',
        originalFilename: 'x.pdf',
        url: '/uploads/x.pdf',
        mimeType: 'application/pdf',
        size: 1,
        uploadedAt: '',
        storageProvider: 'files',
      }

      await expect(
        harness.context.db.Doc.create({ data: { attachment: metadata } }),
      ).rejects.toThrow()

      const rows = await harness.context.sudo().db.Doc.all()
      expect(rows).toHaveLength(0)
    })

    it('accepts a metadata-shaped value under sudo, and stores it verbatim', async () => {
      const metadata: FileMetadata = {
        filename: 'x.pdf',
        originalFilename: 'x.pdf',
        url: '/uploads/x.pdf',
        mimeType: 'application/pdf',
        size: 1,
        uploadedAt: '',
        storageProvider: 'files',
      }

      const created = present(
        await harness.context.sudo().db.Doc.create({ data: { attachment: metadata } }),
        'sudo create',
      )
      expect(created.attachment).toEqual(metadata)
    })
  })

  describe('update: resubmitting the row’s own current value', () => {
    it('succeeds without re-uploading or deleting anything (single-column)', async () => {
      const created = present(
        await harness.context.db.Doc.create({ data: { attachment: pdfFile('a.pdf') } }),
        'create',
      )
      const stored = present(created.attachment, 'Doc.attachment') as FileMetadata

      const updated = present(
        await harness.context.db.Doc.update({
          where: { id: idOf(created) },
          data: { attachment: stored },
        }),
        'resubmit update',
      )

      expect(updated.attachment).toEqual(stored)
      // The uploaded file is still there — a resubmit is not a delete either.
      expect(await exists(join(uploadDir, stored.filename))).toBe(true)
    })
  })

  describe('update: a metadata value differing from the currently stored one', () => {
    it('throws for a traversal filename', async () => {
      const created = present(
        await harness.context.db.Doc.create({ data: { attachment: pdfFile('a.pdf') } }),
        'create',
      )
      const forged: FileMetadata = {
        filename: '../../victim.txt',
        originalFilename: 'x',
        url: 'javascript:alert(1)',
        mimeType: 'text/plain',
        size: 1,
        uploadedAt: 'now',
        storageProvider: 'files',
      }

      await expect(
        harness.context.db.Doc.update({
          where: { id: idOf(created) },
          data: { attachment: forged },
        }),
      ).rejects.toThrow()
    })

    it('throws for a copy of another row’s real metadata', async () => {
      const rowA = present(
        await harness.context.db.Doc.create({ data: { avatar: pngFile('a.png') } }),
        'create A',
      )
      const rowB = present(
        await harness.context.db.Doc.create({ data: { avatar: pngFile('b.png') } }),
        'create B',
      )
      const metadataA = present(rowA.avatar, 'A.avatar') as ImageMetadata

      await expect(
        harness.context.db.Doc.update({
          where: { id: idOf(rowB) },
          data: { avatar: metadataA },
        }),
      ).rejects.toThrow()
    })

    it('throws for a changed storageProvider', async () => {
      const created = present(
        await harness.context.db.Doc.create({ data: { attachment: pdfFile('a.pdf') } }),
        'create',
      )
      const stored = present(created.attachment, 'Doc.attachment') as FileMetadata
      const tampered: FileMetadata = { ...stored, storageProvider: 'other' }

      await expect(
        harness.context.db.Doc.update({
          where: { id: idOf(created) },
          data: { attachment: tampered },
        }),
      ).rejects.toThrow()
    })
  })

  describe('reproduction from #1619', () => {
    it('cleanupOnDelete refuses to delete a planted traversal path, and the row delete still succeeds', async () => {
      const victimPath = join(uploadDir, '..', `victim-${Date.now()}.txt`)
      await writeFile(victimPath, 'do not delete me')

      const planted = present(
        await harness.context.sudo().db.Doc.create({
          data: {
            attachment: {
              filename: `../${victimPath.split('/').pop()}`,
              originalFilename: 'v',
              url: '/uploads/../victim.txt',
              mimeType: 'text/plain',
              size: 1,
              uploadedAt: '',
              storageProvider: 'files',
            },
          },
        }),
        'sudo plant',
      )

      const deleted = await harness.context.db.Doc.delete({ where: { id: idOf(planted) } })
      expect(deleted).not.toBeNull()
      expect(await exists(victimPath)).toBe(true)

      await rm(victimPath, { force: true })
    })
  })

  describe('cleanup uses the field’s configured provider, never the stored value’s', () => {
    it('deletes the real file through "files" even after the stored storageProvider is tampered to "other"', async () => {
      const created = present(
        await harness.context.db.Doc.create({ data: { attachment: pdfFile('keep.pdf') } }),
        'create',
      )
      const stored = present(created.attachment, 'Doc.attachment') as FileMetadata
      expect(await exists(join(uploadDir, stored.filename))).toBe(true)

      // Only sudo can plant a differing storageProvider — an ordinary update
      // with this tampered value is exactly what the previous describe block
      // proves gets refused.
      await present(
        await harness.context.sudo().db.Doc.update({
          where: { id: idOf(created) },
          data: { attachment: { ...stored, storageProvider: 'other' } },
        }),
        'sudo tamper',
      )

      const deleted = await harness.context.db.Doc.delete({ where: { id: idOf(created) } })
      expect(deleted).not.toBeNull()

      // Cleanup used the FIELD's configured provider ('files'), so the real
      // file is gone — not left orphaned by a delete issued against 'other'.
      expect(await exists(join(uploadDir, stored.filename))).toBe(false)
    })
  })
})
