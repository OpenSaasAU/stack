import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { text } from '@opensaas/stack-core/fields'
import { localStorage } from '../src/config/index.js'
import { image, file } from '../src/fields/index.js'
import { createStorageUtils } from '../src/runtime/index.js'

const BOOT = 120_000
const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

const PNG_BYTES = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xff, 0xff, 0x3f,
  0x03, 0x00, 0x08, 0xfc, 0x02, 0xfe, 0xa7, 0x35, 0x81, 0x84, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]
const png = (name: string) => new File([new Uint8Array(PNG_BYTES)], name, { type: 'image/png' })
const pdf = (name: string) =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' })

let uploadDir: string

describe('cleanupOnReplace only deletes once the write committed', () => {
  let harness: TestContext

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'opensaas-storage-replace-'))
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      storage: { files: localStorage({ uploadDir, serveUrl: '/uploads' }) },
      lists: {
        Locked: {
          fields: {
            avatar: image({
              storage: 'files',
              cleanupOnReplace: true,
              access: { update: () => false },
            }),
          },
          access: { operation: OPEN },
        },
        Doc: {
          fields: {
            title: text({ validation: { length: { max: 5 } } }),
            attachment: file({
              storage: 'files',
              cleanupOnReplace: true,
              hooks: { afterTransaction: () => undefined },
            }),
            avatar: image({ storage: 'files', cleanupOnReplace: true }),
            second: file({ storage: 'files', cleanupOnReplace: true }),
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
    for (const name of await readdir(uploadDir))
      await rm(join(uploadDir, name), { recursive: true, force: true })
  })

  it('keeps the old file and removes the new upload when field access denies the update', async () => {
    const row = await harness.context.sudo().db.Locked.create({ data: { avatar: png('a.png') } })
    const id = (row as { id: string }).id
    const before = await readdir(uploadDir)
    expect(before).toHaveLength(1)

    await expect(
      harness.context.db.Locked.update({ where: { id }, data: { avatar: png('b.png') } }),
    ).rejects.toThrow()

    expect(await readdir(uploadDir)).toEqual(before)
  })

  it('keeps the old file when another field fails validation', async () => {
    const row = await harness.context.db.Doc.create({
      data: { title: 'ok', attachment: pdf('a.pdf') },
    })
    const id = (row as { id: string }).id
    const before = await readdir(uploadDir)

    await expect(
      harness.context.db.Doc.update({
        where: { id },
        data: { title: 'waytoolong', attachment: pdf('b.pdf') },
      }),
    ).rejects.toThrow()

    expect(await readdir(uploadDir)).toEqual(before)
  })

  it('deletes the old file after a committed replace', async () => {
    const row = await harness.context.db.Doc.create({
      data: { title: 'ok', attachment: pdf('a.pdf'), avatar: png('a.png') },
    })
    const id = (row as { id: string }).id
    const before = await readdir(uploadDir)

    await harness.context.db.Doc.update({
      where: { id },
      data: { attachment: pdf('b.pdf'), avatar: png('b.png') },
    })

    const after = await readdir(uploadDir)
    expect(after).toHaveLength(2)
    expect(after.some((name) => before.includes(name))).toBe(false)
  })

  it('cleans up each field independently when one File instance feeds two fields', async () => {
    const shared = pdf('shared.pdf')
    const row = await harness.context.db.Doc.create({
      data: { title: 'ok', attachment: pdf('a.pdf'), second: pdf('s.pdf') },
    })
    const id = (row as { id: string }).id
    const before = await readdir(uploadDir)

    await harness.context.db.Doc.update({
      where: { id },
      data: { attachment: shared, second: shared },
    })

    const after = await readdir(uploadDir)
    expect(after).toHaveLength(2)
    expect(after.some((name) => before.includes(name))).toBe(false)
  })

  it('removes every upload when two writes in one transaction share a data object and it rolls back', async () => {
    const data = { title: 'ok', attachment: pdf('shared.pdf') }

    await harness.context
      .transaction(async (tx) => {
        await tx.db.Doc.create({ data })
        await tx.db.Doc.create({ data })
        throw new Error('rollback')
      })
      .catch(() => undefined)

    expect(await readdir(uploadDir)).toEqual([])
  })

  it('keeps both uploads when two writes sharing a data object commit', async () => {
    const data = { title: 'ok', attachment: pdf('shared.pdf') }

    await harness.context.transaction(async (tx) => {
      await tx.db.Doc.create({ data })
      await tx.db.Doc.create({ data })
    })

    expect(await readdir(uploadDir)).toHaveLength(2)
  })
})

describe('cleanupOnDelete only deletes once the delete committed', () => {
  let harness: TestContext

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'opensaas-storage-delete-'))
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      storage: { files: localStorage({ uploadDir, serveUrl: '/uploads' }) },
      lists: {
        Doc: {
          fields: {
            attachment: file({ storage: 'files', cleanupOnDelete: true }),
            avatar: image({ storage: 'files', cleanupOnDelete: true }),
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
    for (const name of await readdir(uploadDir))
      await rm(join(uploadDir, name), { recursive: true, force: true })
  })

  it('keeps the files when the surrounding transaction rolls back', async () => {
    const row = await harness.context.db.Doc.create({
      data: { attachment: pdf('a.pdf'), avatar: png('a.png') },
    })
    const id = (row as { id: string }).id
    const before = await readdir(uploadDir)
    expect(before).toHaveLength(2)

    await expect(
      harness.context.transaction(async (tx) => {
        await tx.db.Doc.delete({ where: { id } })
        throw new Error('later step failed')
      }),
    ).rejects.toThrow('later step failed')

    expect(await readdir(uploadDir)).toEqual(before)
    expect(await harness.context.db.Doc.where({ id: { equals: id } }).first()).not.toBeNull()
  })

  it('deletes the files after a committed delete', async () => {
    const row = await harness.context.db.Doc.create({
      data: { attachment: pdf('a.pdf'), avatar: png('a.png') },
    })
    const id = (row as { id: string }).id

    await harness.context.db.Doc.delete({ where: { id } })

    expect(await readdir(uploadDir)).toEqual([])
  })
  it('deletes the files once a surrounding transaction commits', async () => {
    const row = await harness.context.db.Doc.create({
      data: { attachment: pdf('a.pdf'), avatar: png('a.png') },
    })
    const id = (row as { id: string }).id

    await harness.context.transaction(async (tx) => {
      await tx.db.Doc.delete({ where: { id } })
    })

    expect(await readdir(uploadDir)).toEqual([])
  })
})
