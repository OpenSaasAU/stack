import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { text } from '@opensaas/stack-core/fields'
import { localStorage } from '../src/config/index.js'
import { file } from '../src/fields/index.js'
import { createStorageUtils } from '../src/runtime/index.js'
import { LocalStorageProvider } from '../src/providers/local.js'

const BOOT = 120_000
const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }
const pdf = (name: string, body: string) =>
  new File([new TextEncoder().encode(`%PDF-${body}`)], name, { type: 'application/pdf' })

describe('stable filenames stage uploads until the write commits', () => {
  let harness: TestContext
  let uploadDir: string

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'opensaas-storage-staging-'))
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      storage: {
        files: localStorage({ uploadDir, serveUrl: '/uploads', generateUniqueFilenames: false }),
      },
      lists: {
        Doc: {
          fields: {
            title: text({ validation: { length: { max: 5 } } }),
            a: file({ storage: 'files' }),
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

  it('leaves the original bytes when the write is rejected', async () => {
    const row = await harness.context.db.Doc.create({
      data: { title: 'ok', a: pdf('report.pdf', 'ORIGINAL') },
    })
    const id = (row as { id: string }).id

    await expect(
      harness.context.db.Doc.update({
        where: { id },
        data: { title: 'too long title', a: pdf('report.pdf', 'REJECTED-REPLACEMENT') },
      }),
    ).rejects.toThrow()

    expect(await readdir(uploadDir)).toEqual(['report.pdf'])
    expect(await readFile(join(uploadDir, 'report.pdf'), 'utf8')).toBe('%PDF-ORIGINAL')
  })

  it('lands a committed replacement on the stable key', async () => {
    const row = await harness.context.db.Doc.create({
      data: { title: 'ok', a: pdf('report.pdf', 'ORIGINAL') },
    })
    const id = (row as { id: string }).id

    const updated = await harness.context.db.Doc.update({
      where: { id },
      data: { a: pdf('report.pdf', 'REPLACEMENT') },
    })

    expect(await readdir(uploadDir)).toEqual(['report.pdf'])
    expect(await readFile(join(uploadDir, 'report.pdf'), 'utf8')).toBe('%PDF-REPLACEMENT')
    expect(updated?.a?.filename).toBe('report.pdf')
    expect(updated?.a?.url).toBe('/uploads/report.pdf')
  })
})

describe('LocalStorageProvider.move', () => {
  it('replaces the destination', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'opensaas-storage-move-'))
    try {
      const provider = new LocalStorageProvider({
        type: 'local',
        uploadDir: dir,
        serveUrl: '/uploads',
      })
      await writeFile(join(dir, 'from.txt'), 'new')
      await writeFile(join(dir, 'to.txt'), 'old')

      await provider.move('from.txt', 'to.txt')

      expect(await readdir(dir)).toEqual(['to.txt'])
      expect(await readFile(join(dir, 'to.txt'), 'utf8')).toBe('new')
      await expect(provider.move('x.txt', '../escape.txt')).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
