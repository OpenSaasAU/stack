import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { localStorage } from '../src/config/index.js'
import { file } from '../src/fields/index.js'
import { createStorageUtils } from '../src/runtime/index.js'

const BOOT = 120_000
const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }
const pdf = (name: string) =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' })

describe('cleanup keeps an asset another row still references', () => {
  let harness: TestContext
  let uploadDir: string

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'opensaas-storage-shared-'))
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      storage: { files: localStorage({ uploadDir, serveUrl: '/uploads' }) },
      lists: {
        Doc: {
          fields: {
            attachment: file({ storage: 'files', cleanupOnDelete: true, cleanupOnReplace: true }),
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

  async function sharedPair() {
    const a = await harness.context.db.Doc.create({ data: { attachment: pdf('a.pdf') } })
    if (a === null) throw new Error('create denied')
    const b = await harness.context.sudo().db.Doc.create({ data: { attachment: a.attachment } })
    if (b === null) throw new Error('sudo create denied')
    return { a, b }
  }

  it('keeps the file when one of two rows sharing it is deleted, then removes it with the last', async () => {
    const { a, b } = await sharedPair()
    expect(await readdir(uploadDir)).toHaveLength(1)

    await harness.context.db.Doc.delete({ where: { id: b.id } })
    expect(await readdir(uploadDir)).toHaveLength(1)

    await harness.context.db.Doc.delete({ where: { id: a.id } })
    expect(await readdir(uploadDir)).toEqual([])
  })

  it('keeps the file when one of two rows sharing it is replaced, then removes it with the last', async () => {
    const { a, b } = await sharedPair()
    const shared = await readdir(uploadDir)

    await harness.context.db.Doc.update({ where: { id: b.id }, data: { attachment: pdf('b.pdf') } })
    expect(await readdir(uploadDir)).toEqual(expect.arrayContaining(shared))
    expect(await readdir(uploadDir)).toHaveLength(2)

    await harness.context.db.Doc.update({ where: { id: a.id }, data: { attachment: pdf('c.pdf') } })
    const after = await readdir(uploadDir)
    expect(after).toHaveLength(2)
    expect(after.some((name) => shared.includes(name))).toBe(false)
  })
})
