import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { access, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { createStorageUtils } from '@opensaas/stack-storage/runtime'
import config from '../opensaas.config.js'

const BOOT = 120_000

/** Narrows away the silent-denial `null` every secured read and write can return. */
function present<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`${what} returned null — denied, or not found`)
  return value
}

/** A 1x1 PNG — small, and a real image, so sharp's transformations can run. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n', 'utf8')

/** Where the example's `localStorage()` providers write, relative to the project root. */
const UPLOAD_ROOT = join(import.meta.dirname, '..', 'public', 'uploads')

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * `serveUrl` is the public prefix the metadata records; the same basename lives
 * under `uploadDir`. Turning one into the other is how a test reaches the byte
 * the provider actually wrote.
 */
function diskPathFor(url: string): string {
  const [, area, filename] = url.split('/').filter(Boolean)
  return join(UPLOAD_ROOT, area, filename)
}

describe('file and image uploads round-trip through the secured context', () => {
  let harness: TestContext
  const written: string[] = []

  /** Remember every file an upload put on disk, derivatives included, to remove after. */
  function track(stored: { url: string; transformations?: Record<string, { url: string }> }): void {
    written.push(diskPathFor(stored.url))
    for (const derivative of Object.values(stored.transformations ?? {})) {
      written.push(diskPathFor(derivative.url))
    }
  }

  beforeAll(async () => {
    const resolved = await config
    // The generated context wires this in an app; a test on the harness passes
    // the same surface, or a storage-backed field has nothing to write through.
    harness = await createTestContext(resolved, null, { storage: createStorageUtils(resolved) })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
    await Promise.all(written.map((path) => rm(path, { force: true })))
  })

  it('uploads an image, stores its metadata, and writes the bytes', async () => {
    const avatar = new File([new Uint8Array(PNG)], 'avatar.png', { type: 'image/png' })

    const created = present(
      await harness.context.db.User.create({
        data: { name: 'Ada', email: 'ada@example.com', avatar },
      }),
      'User.create',
    )

    const stored = created.avatar
    if (stored === null || stored instanceof File) throw new Error('avatar did not resolve')
    expect(stored.originalFilename).toBe('avatar.png')
    expect(stored.mimeType).toBe('image/png')
    expect(stored.size).toBe(PNG.byteLength)
    expect(stored.url).toContain('/uploads/avatars/')

    const onDisk = diskPathFor(stored.url)
    track(stored)
    expect(await exists(onDisk)).toBe(true)
    expect(await readFile(onDisk)).toEqual(PNG)

    // The field declares thumbnail and profile transformations, so sharp ran
    // and each derivative is on disk beside the original.
    const thumbnail = stored.transformations?.thumbnail
    if (thumbnail === undefined) throw new Error('thumbnail transformation missing')
    expect(await exists(diskPathFor(thumbnail.url))).toBe(true)
  })

  it('reads the stored image metadata back out of the database', async () => {
    const avatar = new File([new Uint8Array(PNG)], 'second.png', { type: 'image/png' })
    const created = present(
      await harness.context.db.User.create({
        data: { name: 'Grace', email: 'grace@example.com', avatar },
      }),
      'User.create',
    )

    const read = present(
      await harness.context.db.User.where({ id: { equals: created.id } }).first(),
      'User read',
    )
    const stored = read.avatar
    if (stored === null || stored instanceof File) throw new Error('avatar did not resolve')
    track(stored)
    expect(stored.originalFilename).toBe('second.png')
    expect(stored.url).toContain('/uploads/avatars/')
  })

  it('uploads a document to a second named provider', async () => {
    const attachment = new File([new Uint8Array(PDF)], 'brief.pdf', { type: 'application/pdf' })

    const created = present(
      await harness.context.db.Post.create({
        data: { title: 'With an attachment', content: 'See the PDF.', attachment },
      }),
      'Post.create',
    )

    const stored = created.attachment
    if (stored === null || stored instanceof File) throw new Error('attachment did not resolve')
    expect(stored.originalFilename).toBe('brief.pdf')
    expect(stored.url).toContain('/uploads/documents/')

    const onDisk = diskPathFor(stored.url)
    track(stored)
    expect(await readFile(onDisk)).toEqual(PDF)
  })

  it('leaves an unwritten file field null', async () => {
    const created = present(
      await harness.context.db.Post.create({ data: { title: 'Plain', content: 'No files.' } }),
      'Post.create',
    )
    expect(created.coverImage).toBeNull()
    expect(created.attachment).toBeNull()
  })

  it('clears an uploaded file by assigning null', async () => {
    const attachment = new File([new Uint8Array(PDF)], 'temp.pdf', { type: 'application/pdf' })
    const created = present(
      await harness.context.db.Post.create({ data: { title: 'Temporary', attachment } }),
      'Post.create',
    )
    const stored = created.attachment
    if (stored === null || stored instanceof File) throw new Error('attachment did not resolve')
    track(stored)

    const cleared = present(
      await harness.context.db.Post.update({
        where: { id: created.id },
        data: { attachment: null },
      }),
      'Post.update',
    )
    expect(cleared.attachment).toBeNull()
  })
})
