import { describe, it, expect, vi } from 'vitest'
import { image, file } from '../src/fields/index.js'
import type { ImageMetadata, FileMetadata } from '../src/config/types.js'

/**
 * Field-level behaviour of image()/file() in multi-column (Keystone-parity)
 * mode, plus the no-re-upload guarantee in BOTH modes. See ADR-0006 / issue #477.
 */

/** A File-like stub with an arrayBuffer() method (triggers an upload). */
function fakeFile(bytes = [1, 2, 3]): File {
  return {
    name: 'photo.png',
    type: 'image/png',
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as unknown as File
}

/** A context whose storage records every upload call so we can assert on it. */
function makeContext() {
  const uploadImage = vi.fn(async (): Promise<ImageMetadata> => ({
    filename: 'new.png',
    originalFilename: 'photo.png',
    url: '/uploads/new.png',
    mimeType: 'image/png',
    size: 3,
    width: 10,
    height: 10,
    uploadedAt: new Date().toISOString(),
    storageProvider: 'images',
  }))
  const uploadFile = vi.fn(async (): Promise<FileMetadata> => ({
    filename: 'new.pdf',
    originalFilename: 'doc.pdf',
    url: '/uploads/new.pdf',
    mimeType: 'application/pdf',
    size: 3,
    uploadedAt: new Date().toISOString(),
    storageProvider: 'documents',
  }))
  return {
    context: { storage: { uploadImage, uploadFile, deleteImage: vi.fn(), deleteFile: vi.fn() } },
    uploadImage,
    uploadFile,
  }
}

describe('image() / file() multi-column mode', () => {
  describe('single-Json? default is unchanged', () => {
    it('image() default has no multi-column methods and emits Json?', () => {
      const field = image({ storage: 'images' })
      expect(field.getPrismaColumns).toBeUndefined()
      expect(field.getColumnNames).toBeUndefined()
      expect(field.assembleColumns).toBeUndefined()
      expect(field.splitColumns).toBeUndefined()
      expect(field.getPrismaType?.('image')).toEqual({ type: 'Json', modifiers: '?' })
    })

    it('file() default has no multi-column methods and emits Json?', () => {
      const field = file({ storage: 'documents' })
      expect(field.getPrismaColumns).toBeUndefined()
      expect(field.getPrismaType?.('doc')).toEqual({ type: 'Json', modifiers: '?' })
    })
  })

  describe('multi-column emission', () => {
    it('image() in keystone mode emits seven @map-ped nullable columns', () => {
      const field = image({ storage: 'images', db: { columns: 'keystone' } })
      const columns = field.getPrismaColumns?.('image')
      expect(columns).toHaveLength(7)
      expect(columns?.every((c) => c.modifiers === '?')).toBe(true)
      expect(columns?.map((c) => c.map)).toEqual([
        'image_url',
        'image_width',
        'image_height',
        'image_filesize',
        'image_contentType',
        'image_contentDisposition',
        'image_pathname',
      ])
      expect(field.getColumnNames?.('image')).toHaveLength(7)
    })

    it('file() in keystone mode emits three @map-ped nullable columns', () => {
      const field = file({ storage: 'documents', db: { columns: 'keystone' } })
      const columns = field.getPrismaColumns?.('doc')
      expect(columns).toHaveLength(3)
      expect(columns?.every((c) => c.modifiers === '?')).toBe(true)
      expect(columns?.map((c) => c.map)).toEqual(['doc_filename', 'doc_filesize', 'doc_url'])
      // filesize is Int; filename/url are String.
      const byMap = Object.fromEntries((columns ?? []).map((c) => [c.map, c.type]))
      expect(byMap.doc_filesize).toBe('Int')
      expect(byMap.doc_filename).toBe('String')
      expect(byMap.doc_url).toBe('String')
      expect(field.getColumnNames?.('doc')).toEqual(['doc_filename', 'doc_filesize', 'doc_url'])
    })

    it('file() per-part @map names are configurable', () => {
      const field = file({
        storage: 'documents',
        db: { columns: { mode: 'keystone', map: { url: 'doc_href' } } },
      })
      const maps = field.getPrismaColumns?.('doc')?.map((c) => c.map)
      expect(maps).toContain('doc_href')
      // Un-overridden parts keep Keystone defaults.
      expect(maps).toContain('doc_filename')
      expect(maps).not.toContain('doc_url')
      expect(field.getColumnNames?.('doc')).toContain('doc_href')
    })

    it('per-part @map names are configurable', () => {
      const field = image({
        storage: 'images',
        db: { columns: { mode: 'keystone', map: { url: 'image_link', pathname: 'image_key' } } },
      })
      const columns = field.getPrismaColumns?.('image')
      const maps = columns?.map((c) => c.map)
      expect(maps).toContain('image_link')
      expect(maps).toContain('image_key')
      // Un-overridden parts keep Keystone defaults.
      expect(maps).toContain('image_width')
      expect(field.getColumnNames?.('image')).toContain('image_link')
    })
  })

  describe('assemble (read) and split (write)', () => {
    it('image() assembles its columns and a url-only row yields a valid value', () => {
      const field = image({ storage: 'images', db: { columns: 'keystone' } })
      const full = field.assembleColumns?.('image', {
        image_url: '/u/a.jpg',
        image_width: 100,
        image_height: 50,
        image_filesize: 1024,
        image_contentType: 'image/jpeg',
        image_pathname: 'a.jpg',
      }) as ImageMetadata
      expect(full.url).toBe('/u/a.jpg')
      expect(full.width).toBe(100)
      expect(full.storageProvider).toBe('images')

      const partial = field.assembleColumns?.('image', {
        image_url: '/u/only.jpg',
      }) as ImageMetadata
      expect(partial.url).toBe('/u/only.jpg')
      expect(partial.width).toBe(0)
    })

    it('image() split writes back into the per-part columns', () => {
      const field = image({ storage: 'images', db: { columns: 'keystone' } })
      const meta: ImageMetadata = {
        filename: 'a.jpg',
        originalFilename: 'a.jpg',
        url: '/u/a.jpg',
        mimeType: 'image/jpeg',
        size: 1024,
        width: 100,
        height: 50,
        uploadedAt: '',
        storageProvider: 'images',
      }
      const columns = field.splitColumns?.('image', meta)
      expect(columns).toMatchObject({
        image_url: '/u/a.jpg',
        image_width: 100,
        image_height: 50,
        image_filesize: 1024,
        image_contentType: 'image/jpeg',
        image_pathname: 'a.jpg',
      })
    })

    it('file() assembles a fully-populated row into FileMetadata', () => {
      const field = file({ storage: 'documents', db: { columns: 'keystone' } })
      const meta = field.assembleColumns?.('doc', {
        doc_filename: 'report.pdf',
        doc_filesize: 4096,
        doc_url: 'https://cdn/report.pdf',
      }) as FileMetadata
      expect(meta.url).toBe('https://cdn/report.pdf')
      expect(meta.filename).toBe('report.pdf')
      expect(meta.size).toBe(4096)
      expect(meta.storageProvider).toBe('documents')
    })

    it('file() assembles a partial row (only doc_url) into a valid value', () => {
      const field = file({ storage: 'documents', db: { columns: 'keystone' } })
      const meta = field.assembleColumns?.('doc', {
        doc_url: 'https://cdn/only.pdf',
      }) as FileMetadata
      expect(meta.url).toBe('https://cdn/only.pdf')
      // Missing filename falls back to the URL; missing filesize defaults to 0.
      expect(meta.filename).toBe('https://cdn/only.pdf')
      expect(meta.size).toBe(0)
    })

    it('file() assembles an empty (all-NULL) row to null', () => {
      const field = file({ storage: 'documents', db: { columns: 'keystone' } })
      expect(
        field.assembleColumns?.('doc', { doc_url: null, doc_filename: null, doc_filesize: null }),
      ).toBeNull()
    })

    it('file() split writes back into the per-part columns', () => {
      const field = file({ storage: 'documents', db: { columns: 'keystone' } })
      const meta: FileMetadata = {
        filename: 'report.pdf',
        originalFilename: 'report.pdf',
        url: 'https://cdn/report.pdf',
        mimeType: 'application/pdf',
        size: 4096,
        uploadedAt: '',
        storageProvider: 'documents',
      }
      expect(field.splitColumns?.('doc', meta)).toEqual({
        doc_filename: 'report.pdf',
        doc_filesize: 4096,
        doc_url: 'https://cdn/report.pdf',
      })
    })

    it('file() round-trips a row through assemble → split with custom @map names', () => {
      const field = file({
        storage: 'documents',
        db: { columns: { mode: 'keystone', map: { url: 'doc_href' } } },
      })
      const row = { doc_filename: 'a.bin', doc_filesize: 12, doc_href: 'https://cdn/a.bin' }
      const meta = field.assembleColumns?.('doc', row)
      expect((meta as FileMetadata).url).toBe('https://cdn/a.bin')
      // Split back lands on the overridden physical column, not doc_url.
      expect(field.splitColumns?.('doc', meta)).toEqual(row)
    })

    it('file() split of null clears all columns', () => {
      const field = file({ storage: 'documents', db: { columns: 'keystone' } })
      expect(field.splitColumns?.('doc', null)).toEqual({
        doc_filename: null,
        doc_filesize: null,
        doc_url: null,
      })
    })
  })

  describe('field-level write access is preserved alongside the column split', () => {
    // The core write pipeline gates the multi-column split on the field's own
    // write access (so a denied multi-column field writes NONE of its per-part
    // columns — see packages/core/.../multi-column-read-write.test.ts). For that
    // gate to fire, the field builder must surface the user-provided `access` on
    // the config (the same object key the single-column path reads). These tests
    // lock that wiring for the real image()/file() fields. See ADR-0006 / #477.
    it('image() in multi-column mode carries user access AND splitColumns together', () => {
      const denyUpdate = () => false
      const field = image({
        storage: 'images',
        db: { columns: 'keystone' },
        access: { update: denyUpdate },
      })
      expect(field.access?.update).toBe(denyUpdate)
      // The gate has both inputs it needs: the access object and the splitter.
      expect(typeof field.splitColumns).toBe('function')
    })

    it('file() in multi-column mode carries user access AND splitColumns together', () => {
      const denyCreate = () => false
      const field = file({
        storage: 'documents',
        db: { columns: 'keystone' },
        access: { create: denyCreate },
      })
      expect(field.access?.create).toBe(denyCreate)
      expect(typeof field.splitColumns).toBe('function')
    })

    it('single-column image() still carries access and has no splitColumns', () => {
      const denyUpdate = () => false
      const field = image({ storage: 'images', access: { update: denyUpdate } })
      expect(field.access?.update).toBe(denyUpdate)
      expect(field.splitColumns).toBeUndefined()
    })
  })

  describe('no-re-upload guarantee', () => {
    it('image() does NOT upload when given an existing ImageMetadata (single-Json mode)', async () => {
      const field = image({ storage: 'images' })
      const { context, uploadImage } = makeContext()
      const existing: ImageMetadata = {
        filename: 'a.jpg',
        originalFilename: 'a.jpg',
        url: '/u/a.jpg',
        mimeType: 'image/jpeg',
        size: 1,
        width: 1,
        height: 1,
        uploadedAt: '',
        storageProvider: 'images',
      }
      const result = await field.hooks?.resolveInput?.({
        listKey: 'Post',
        fieldKey: 'image',
        operation: 'update',
        inputData: { image: existing },
        item: { image: existing },
        resolvedData: { image: existing },
        context,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      expect(uploadImage).not.toHaveBeenCalled()
      expect(result).toBe(existing)
    })

    it('image() does NOT upload when given an existing ImageMetadata (multi-column mode)', async () => {
      const field = image({ storage: 'images', db: { columns: 'keystone' } })
      const { context, uploadImage } = makeContext()
      const existing: ImageMetadata = {
        filename: 'a.jpg',
        originalFilename: 'a.jpg',
        url: '/u/a.jpg',
        mimeType: 'image/jpeg',
        size: 1,
        width: 1,
        height: 1,
        uploadedAt: '',
        storageProvider: 'images',
      }
      const result = await field.hooks?.resolveInput?.({
        listKey: 'Post',
        fieldKey: 'image',
        operation: 'create',
        inputData: { image: existing },
        item: undefined,
        resolvedData: { image: existing },
        context,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      expect(uploadImage).not.toHaveBeenCalled()
      expect(result).toBe(existing)
    })

    it('image() DOES upload when given a File-like input', async () => {
      const field = image({ storage: 'images', db: { columns: 'keystone' } })
      const { context, uploadImage } = makeContext()
      const result = await field.hooks?.resolveInput?.({
        listKey: 'Post',
        fieldKey: 'image',
        operation: 'create',
        inputData: { image: fakeFile() },
        item: undefined,
        resolvedData: { image: fakeFile() },
        context,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      expect(uploadImage).toHaveBeenCalledTimes(1)
      expect((result as ImageMetadata).url).toBe('/uploads/new.png')
    })

    it('file() does NOT upload existing metadata but DOES upload a File-like input', async () => {
      const field = file({ storage: 'documents', db: { columns: 'keystone' } })
      const { context, uploadFile } = makeContext()
      const existing: FileMetadata = {
        filename: 'd.pdf',
        originalFilename: 'd.pdf',
        url: '/u/d.pdf',
        mimeType: 'application/pdf',
        size: 1,
        uploadedAt: '',
        storageProvider: 'documents',
      }
      const kept = await field.hooks?.resolveInput?.({
        listKey: 'Post',
        fieldKey: 'doc',
        operation: 'update',
        inputData: { doc: existing },
        item: { doc: existing },
        resolvedData: { doc: existing },
        context,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      expect(uploadFile).not.toHaveBeenCalled()
      expect(kept).toBe(existing)

      await field.hooks?.resolveInput?.({
        listKey: 'Post',
        fieldKey: 'doc',
        operation: 'create',
        inputData: { doc: fakeFile() },
        item: undefined,
        resolvedData: { doc: fakeFile() },
        context,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      expect(uploadFile).toHaveBeenCalledTimes(1)
    })
  })
})
