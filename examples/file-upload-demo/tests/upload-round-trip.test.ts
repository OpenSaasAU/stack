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

/**
 * `createTestContext` is not generic over the config's lists — it hands back
 * `StackContext<AccessControlledDB>`, whose rows are untyped — so a stored file
 * field arrives as `unknown`. The three readers below are what earn the type;
 * a cast would only assert it, and the value came from the database.
 */
function stringAt(source: unknown, key: string, what: string): string {
  const value = typeof source !== 'object' || source === null ? undefined : Reflect.get(source, key)
  if (typeof value !== 'string') throw new Error(`${what}.${key} is not a string`)
  return value
}

function numberAt(source: unknown, key: string, what: string): number {
  const value = typeof source !== 'object' || source === null ? undefined : Reflect.get(source, key)
  if (typeof value !== 'number') throw new Error(`${what}.${key} is not a number`)
  return value
}

function idOf(row: unknown, what: string): string {
  return stringAt(row, 'id', what)
}

/** Exactly the part of the stored metadata these tests read back. */
interface StoredUpload {
  originalFilename: string
  mimeType: string
  size: number
  url: string
  transformations: Record<string, { url: string }>
}

function asStoredUpload(value: unknown, what: string): StoredUpload {
  if (value === null || value instanceof File) {
    throw new Error(`${what} did not resolve to stored metadata`)
  }
  const transformations: Record<string, { url: string }> = {}
  const raw =
    typeof value === 'object' && value !== null ? Reflect.get(value, 'transformations') : undefined
  if (typeof raw === 'object' && raw !== null) {
    for (const [name, entry] of Object.entries(raw)) {
      transformations[name] = { url: stringAt(entry, 'url', `${what}.transformations.${name}`) }
    }
  }
  return {
    originalFilename: stringAt(value, 'originalFilename', what),
    mimeType: stringAt(value, 'mimeType', what),
    size: numberAt(value, 'size', what),
    url: stringAt(value, 'url', what),
    transformations,
  }
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
  function track(upload: StoredUpload): void {
    written.push(diskPathFor(upload.url))
    for (const derivative of Object.values(upload.transformations)) {
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

    const stored = asStoredUpload(created.avatar, 'User.avatar')
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
    const thumbnail = stored.transformations.thumbnail
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
      await harness.context.db.User.where({ id: { equals: idOf(created, 'created row') } }).first(),
      'User read',
    )
    const stored = asStoredUpload(read.avatar, 'User.avatar')
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

    const stored = asStoredUpload(created.attachment, 'Post.attachment')
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
    track(asStoredUpload(created.attachment, 'Post.attachment'))

    const cleared = present(
      await harness.context.db.Post.update({
        where: { id: idOf(created, 'created row') },
        data: { attachment: null },
      }),
      'Post.update',
    )
    expect(cleared.attachment).toBeNull()
  })
})
