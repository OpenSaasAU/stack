import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { localStorage } from '../src/config/index.js'
import { image } from '../src/fields/index.js'
import { createStorageUtils } from '../src/runtime/index.js'

const BOOT = 120_000
const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

async function png(name: string): Promise<File> {
  const bytes = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#f00' },
  })
    .png()
    .toBuffer()
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' })
}

describe('stable filenames claim image variant keys', () => {
  let harness: TestContext
  let uploadDir: string

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'opensaas-storage-variants-'))
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      storage: {
        files: localStorage({ uploadDir, serveUrl: '/uploads', generateUniqueFilenames: false }),
      },
      lists: {
        Photo: {
          fields: {
            pic: image({
              storage: 'files',
              cleanupOnDelete: true,
              transformations: { thumb: { width: 4, height: 4 } },
            }),
          },
          access: { operation: OPEN },
        },
      },
    }
    harness = await createTestContext(config, null, { storage: createStorageUtils(config) })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
    await rm(uploadDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await harness.truncate()
    for (const name of await readdir(uploadDir)) await rm(join(uploadDir, name), { force: true })
  })

  it("refuses an original whose variant would overwrite another row's original", async () => {
    await harness.context.db.Photo.create({ data: { pic: await png('photo-thumb.png') } })
    await expect(
      harness.context.db.Photo.create({ data: { pic: await png('photo.png') } }),
    ).rejects.toThrow(/already belongs to another item/)
    expect((await readdir(uploadDir)).sort()).toEqual(['photo-thumb-thumb.png', 'photo-thumb.png'])
  })

  it("refuses an original named like another row's variant", async () => {
    await harness.context.db.Photo.create({ data: { pic: await png('photo.png') } })
    await expect(
      harness.context.db.Photo.create({ data: { pic: await png('photo-thumb.png') } }),
    ).rejects.toThrow(/already belongs to another item/)
  })

  it('keeps a variant another row still references when a row is deleted', async () => {
    const a = await harness.context.db.Photo.create({ data: { pic: await png('photo.png') } })
    const meta = (a as { pic: unknown }).pic
    const b = await harness.context.sudo().db.Photo.create({
      data: { pic: { ...(meta as object), filename: 'other.png' } as never },
    })
    await harness.context.db.Photo.delete({ where: { id: (b as { id: string }).id } })
    expect((await readdir(uploadDir)).sort()).toEqual(['photo-thumb.png', 'photo.png'])
  })
})
