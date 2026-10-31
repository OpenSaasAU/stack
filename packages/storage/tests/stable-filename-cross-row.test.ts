import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { text } from '@opensaas/stack-core/fields'
import { localStorage } from '../src/config/index.js'
import { file } from '../src/fields/index.js'
import { createStorageUtils } from '../src/runtime/index.js'

const BOOT = 120_000
const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }
const pdf = (name: string, body: string) =>
  new File([new TextEncoder().encode(body)], name, { type: 'application/pdf' })

let uploadDir: string

describe('stable filenames are per-key, not per-row', () => {
  let harness: TestContext

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'opensaas-storage-stable-'))
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      storage: {
        files: localStorage({ uploadDir, serveUrl: '/uploads', generateUniqueFilenames: false }),
      },
      lists: {
        Doc: {
          fields: {
            title: text({ validation: { length: { max: 5 } } }),
            attachment: file({ storage: 'files', cleanupOnReplace: true, cleanupOnDelete: true }),
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

  const bytes = () => readFile(join(uploadDir, 'report.pdf'), 'utf8')

  it('refuses another row uploading a key a row already owns', async () => {
    await harness.context.db.Doc.create({ data: { attachment: pdf('report.pdf', 'A') } })
    await expect(
      harness.context.db.Doc.create({ data: { attachment: pdf('report.pdf', 'B') } }),
    ).rejects.toThrow(/already belongs to another item/)
    expect(await bytes()).toBe('A')
  })

  it("never deletes another row's file when a write fails", async () => {
    await harness.context.db.Doc.create({ data: { attachment: pdf('report.pdf', 'A') } })
    const other = await harness.context.db.Doc.create({ data: { title: 'b' } })
    await expect(
      harness.context.db.Doc.update({
        where: { id: (other as { id: string }).id },
        data: { title: 'too long', attachment: pdf('report.pdf', 'B') },
      }),
    ).rejects.toThrow()
    expect(await bytes()).toBe('A')
  })

  it('still lets a row replace its own file', async () => {
    const row = await harness.context.db.Doc.create({
      data: { attachment: pdf('report.pdf', 'A') },
    })
    await harness.context.db.Doc.update({
      where: { id: (row as { id: string }).id },
      data: { attachment: pdf('report.pdf', 'A2') },
    })
    expect(await bytes()).toBe('A2')
  })

  it('keeps a shared file when one referencing row is deleted', async () => {
    const a = await harness.context.db.Doc.create({ data: { attachment: pdf('report.pdf', 'A') } })
    const meta = (a as { attachment: unknown }).attachment
    await harness.context.sudo().db.Doc.create({ data: { attachment: meta as never } })
    await harness.context.db.Doc.delete({ where: { id: (a as { id: string }).id } })
    expect(await bytes()).toBe('A')
  })
})
