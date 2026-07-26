import { describe, it, expect } from 'vitest'
import {
  IMAGE_COLUMN_PARTS,
  FILE_COLUMN_PARTS,
  DEFAULT_FILE_COLUMN_PARTS,
  keystoneImageColumnMap,
  keystoneFileColumnMap,
  resolveImageColumnMap,
  resolveFileColumnMap,
  imageColumnDescriptors,
  fileColumnDescriptors,
  imageColumnNames,
  fileColumnNames,
  assembleImageMetadata,
  splitImageMetadata,
  assembleFileMetadata,
  splitFileMetadata,
} from '../src/utils/multi-column.js'
import type { ImageMetadata, FileMetadata } from '../src/config/types.js'

describe('multi-column mapper', () => {
  describe('column-name maps', () => {
    it('builds Keystone default image column names', () => {
      expect(keystoneImageColumnMap('image')).toEqual({
        url: 'image_url',
        width: 'image_width',
        height: 'image_height',
        filesize: 'image_filesize',
        contentType: 'image_contentType',
        contentDisposition: 'image_contentDisposition',
        pathname: 'image_pathname',
      })
    })

    it('builds Keystone default file column names', () => {
      expect(keystoneFileColumnMap('doc')).toEqual({
        filename: 'doc_filename',
        filesize: 'doc_filesize',
        url: 'doc_url',
        pathname: 'doc_pathname',
        contentType: 'doc_contentType',
      })
    })

    it('applies per-part image overrides on top of defaults', () => {
      const map = resolveImageColumnMap('avatar', { url: 'avatar_link', width: 'avatar_w' })
      expect(map.url).toBe('avatar_link')
      expect(map.width).toBe('avatar_w')
      // Un-overridden parts keep the Keystone default.
      expect(map.height).toBe('avatar_height')
      expect(map.pathname).toBe('avatar_pathname')
    })

    it('applies per-part file overrides on top of defaults', () => {
      const map = resolveFileColumnMap('resume', { url: 'resume_href' })
      expect(map.url).toBe('resume_href')
      expect(map.filename).toBe('resume_filename')
    })
  })

  describe('descriptors / column names', () => {
    it('emits seven image columns with @map names', () => {
      const map = keystoneImageColumnMap('image')
      const descriptors = imageColumnDescriptors(map)
      expect(descriptors).toHaveLength(7)
      expect(descriptors.map((d) => d.map)).toEqual([
        'image_url',
        'image_width',
        'image_height',
        'image_filesize',
        'image_contentType',
        'image_contentDisposition',
        'image_pathname',
      ])
      // width/height/filesize are Int, the rest String.
      const byName = Object.fromEntries(descriptors.map((d) => [d.map, d.type]))
      expect(byName.image_width).toBe('Int')
      expect(byName.image_height).toBe('Int')
      expect(byName.image_filesize).toBe('Int')
      expect(byName.image_url).toBe('String')
      expect(byName.image_contentType).toBe('String')
    })

    it('emits three file columns by default (no regression)', () => {
      const descriptors = fileColumnDescriptors(keystoneFileColumnMap('doc'))
      expect(descriptors.map((d) => d.map)).toEqual(['doc_filename', 'doc_filesize', 'doc_url'])
    })

    it('opts into pathname/contentType extras via an explicit parts list', () => {
      const map = keystoneFileColumnMap('doc')
      const descriptors = fileColumnDescriptors(map, FILE_COLUMN_PARTS)
      expect(descriptors.map((d) => d.map)).toEqual([
        'doc_filename',
        'doc_filesize',
        'doc_url',
        'doc_pathname',
        'doc_contentType',
      ])
      const byName = Object.fromEntries(descriptors.map((d) => [d.map, d.type]))
      expect(byName.doc_pathname).toBe('String')
      expect(byName.doc_contentType).toBe('String')
    })

    it('lists column names for read stripping', () => {
      expect(imageColumnNames(keystoneImageColumnMap('image'))).toHaveLength(7)
      expect(fileColumnNames(keystoneFileColumnMap('doc'))).toEqual([
        'doc_filename',
        'doc_filesize',
        'doc_url',
      ])
      expect(fileColumnNames(keystoneFileColumnMap('doc'), ['pathname', 'contentType'])).toEqual([
        'doc_pathname',
        'doc_contentType',
      ])
      expect(IMAGE_COLUMN_PARTS).toHaveLength(7)
      expect(FILE_COLUMN_PARTS).toHaveLength(5)
      expect(DEFAULT_FILE_COLUMN_PARTS).toEqual(['filename', 'filesize', 'url'])
    })
  })

  describe('image assemble/split round-trip', () => {
    const map = keystoneImageColumnMap('image')

    it('assembles a fully-populated row into ImageMetadata', () => {
      const row = {
        image_url: 'https://cdn.example.com/photo.jpg',
        image_width: 800,
        image_height: 600,
        image_filesize: 12345,
        image_contentType: 'image/jpeg',
        image_contentDisposition: 'inline',
        image_pathname: 'photo.jpg',
      }
      const meta = assembleImageMetadata(row, map, 'images')
      expect(meta).toEqual({
        filename: 'photo.jpg',
        originalFilename: 'photo.jpg',
        url: 'https://cdn.example.com/photo.jpg',
        mimeType: 'image/jpeg',
        size: 12345,
        width: 800,
        height: 600,
        uploadedAt: '',
        storageProvider: 'images',
        metadata: { contentDisposition: 'inline' },
      })
    })

    it('round-trips columns → metadata → columns', () => {
      const row = {
        image_url: 'https://cdn.example.com/photo.jpg',
        image_width: 800,
        image_height: 600,
        image_filesize: 12345,
        image_contentType: 'image/jpeg',
        image_contentDisposition: 'inline',
        image_pathname: 'photo.jpg',
      }
      const meta = assembleImageMetadata(row, map, 'images')
      const columns = splitImageMetadata(meta, map)
      expect(columns).toEqual(row)
    })

    it('assembles a partially-populated row (only image_url) into a valid value', () => {
      const meta = assembleImageMetadata(
        { image_url: 'https://cdn.example.com/only.png' },
        map,
        'images',
      )
      expect(meta).not.toBeNull()
      expect(meta?.url).toBe('https://cdn.example.com/only.png')
      // Missing pathname falls back to the URL for filename.
      expect(meta?.filename).toBe('https://cdn.example.com/only.png')
      // Missing scalar parts default to 0.
      expect(meta?.width).toBe(0)
      expect(meta?.height).toBe(0)
      expect(meta?.size).toBe(0)
      // Missing contentType defaults to octet-stream; no contentDisposition metadata.
      expect(meta?.mimeType).toBe('application/octet-stream')
      expect(meta?.metadata).toBeUndefined()
    })

    it('returns null for a row with no url (empty image)', () => {
      expect(assembleImageMetadata({}, map, 'images')).toBeNull()
      expect(
        assembleImageMetadata(
          { image_url: null, image_width: null, image_pathname: null },
          map,
          'images',
        ),
      ).toBeNull()
    })

    it('coerces string-typed numeric columns (e.g. from raw SQL) to numbers', () => {
      const meta = assembleImageMetadata(
        { image_url: 'u', image_width: '640', image_height: '480', image_filesize: '999' },
        map,
        'images',
      )
      expect(meta?.width).toBe(640)
      expect(meta?.height).toBe(480)
      expect(meta?.size).toBe(999)
    })

    it('splits null metadata into all-null columns (clears the field)', () => {
      expect(splitImageMetadata(null, map)).toEqual({
        image_url: null,
        image_width: null,
        image_height: null,
        image_filesize: null,
        image_contentType: null,
        image_contentDisposition: null,
        image_pathname: null,
      })
    })

    it('honours per-part @map overrides on round-trip', () => {
      const custom = resolveImageColumnMap('image', { url: 'image_link' })
      const row = { image_link: 'https://x/y.jpg', image_pathname: 'y.jpg' }
      const meta = assembleImageMetadata(row, custom, 'images')
      expect(meta?.url).toBe('https://x/y.jpg')
      const split = splitImageMetadata(meta, custom)
      expect(split.image_link).toBe('https://x/y.jpg')
    })
  })

  describe('file assemble/split round-trip', () => {
    const map = keystoneFileColumnMap('doc')

    it('assembles a populated row into FileMetadata', () => {
      const meta = assembleFileMetadata(
        { doc_filename: 'report.pdf', doc_filesize: 4096, doc_url: 'https://cdn/report.pdf' },
        map,
        'documents',
      )
      expect(meta).toEqual({
        filename: 'report.pdf',
        originalFilename: 'report.pdf',
        url: 'https://cdn/report.pdf',
        mimeType: 'application/octet-stream',
        size: 4096,
        uploadedAt: '',
        storageProvider: 'documents',
      })
    })

    it('round-trips file columns → metadata → columns', () => {
      const row = {
        doc_filename: 'report.pdf',
        doc_filesize: 4096,
        doc_url: 'https://cdn/report.pdf',
      }
      const meta = assembleFileMetadata(row, map, 'documents')
      expect(splitFileMetadata(meta, map)).toEqual(row)
    })

    it('assembles a partial row (only url) into a valid value', () => {
      const meta = assembleFileMetadata({ doc_url: 'https://cdn/only.pdf' }, map, 'documents')
      expect(meta).not.toBeNull()
      expect(meta?.url).toBe('https://cdn/only.pdf')
      expect(meta?.filename).toBe('https://cdn/only.pdf')
      expect(meta?.size).toBe(0)
    })

    it('assembles a partial row (only filename) into a valid value', () => {
      const meta = assembleFileMetadata({ doc_filename: 'legacy.bin' }, map, 'documents')
      expect(meta).not.toBeNull()
      expect(meta?.filename).toBe('legacy.bin')
      expect(meta?.url).toBe('')
    })

    it('returns null for an empty file row', () => {
      expect(assembleFileMetadata({}, map, 'documents')).toBeNull()
      expect(
        assembleFileMetadata({ doc_url: null, doc_filename: null }, map, 'documents'),
      ).toBeNull()
    })

    it('splits null metadata into all-null columns', () => {
      expect(splitFileMetadata(null, map)).toEqual({
        doc_filename: null,
        doc_filesize: null,
        doc_url: null,
      })
    })

    it('does not read/write pathname/contentType columns when not opted in', () => {
      const row = {
        doc_filename: 'report.pdf',
        doc_filesize: 4096,
        doc_url: 'https://cdn/report.pdf',
        doc_pathname: 'blobs/report.pdf',
        doc_contentType: 'application/pdf',
      }
      const meta = assembleFileMetadata(row, map, 'documents')
      expect(meta?.metadata).toBeUndefined()
      expect(splitFileMetadata(meta, map)).toEqual({
        doc_filename: 'report.pdf',
        doc_filesize: 4096,
        doc_url: 'https://cdn/report.pdf',
      })
    })
  })

  describe('file pathname/contentType extras (opt-in)', () => {
    const map = keystoneFileColumnMap('doc')
    const parts = FILE_COLUMN_PARTS

    it('assembles pathname/contentType columns into metadata.metadata', () => {
      const row = {
        doc_filename: 'report.pdf',
        doc_filesize: 4096,
        doc_url: 'https://cdn/report.pdf',
        doc_pathname: 'blobs/report.pdf',
        doc_contentType: 'application/pdf',
      }
      const meta = assembleFileMetadata(row, map, 'documents', parts)
      expect(meta).toEqual({
        filename: 'report.pdf',
        originalFilename: 'report.pdf',
        url: 'https://cdn/report.pdf',
        mimeType: 'application/octet-stream',
        size: 4096,
        uploadedAt: '',
        storageProvider: 'documents',
        metadata: { pathname: 'blobs/report.pdf', contentType: 'application/pdf' },
      })
    })

    it('round-trips columns → metadata → columns with the extras included', () => {
      const row = {
        doc_filename: 'report.pdf',
        doc_filesize: 4096,
        doc_url: 'https://cdn/report.pdf',
        doc_pathname: 'blobs/report.pdf',
        doc_contentType: 'application/pdf',
      }
      const meta = assembleFileMetadata(row, map, 'documents', parts)
      expect(splitFileMetadata(meta, map, parts)).toEqual(row)
    })

    it('assembles with only one extra present (contentType absent from metadata)', () => {
      const meta = assembleFileMetadata(
        {
          doc_filename: 'report.pdf',
          doc_filesize: 4096,
          doc_url: 'https://cdn/report.pdf',
          doc_pathname: 'blobs/report.pdf',
        },
        map,
        'documents',
        parts,
      )
      expect(meta?.metadata).toEqual({ pathname: 'blobs/report.pdf' })
    })

    it('assembles with neither extra present — no metadata bag at all', () => {
      const meta = assembleFileMetadata(
        { doc_filename: 'report.pdf', doc_filesize: 4096, doc_url: 'https://cdn/report.pdf' },
        map,
        'documents',
        parts,
      )
      expect(meta?.metadata).toBeUndefined()
    })

    it('splits a FileMetadata without the extras into null columns (clearing them)', () => {
      const meta = assembleFileMetadata(
        { doc_filename: 'report.pdf', doc_filesize: 4096, doc_url: 'https://cdn/report.pdf' },
        map,
        'documents',
      )
      expect(splitFileMetadata(meta, map, parts)).toEqual({
        doc_filename: 'report.pdf',
        doc_filesize: 4096,
        doc_url: 'https://cdn/report.pdf',
        doc_pathname: null,
        doc_contentType: null,
      })
    })

    it('splits null metadata into all-null columns including the extras', () => {
      expect(splitFileMetadata(null, map, parts)).toEqual({
        doc_filename: null,
        doc_filesize: null,
        doc_url: null,
        doc_pathname: null,
        doc_contentType: null,
      })
    })

    it('honours per-part @map overrides for the extras', () => {
      const custom = resolveFileColumnMap('doc', { pathname: 'doc_blob_path' })
      const row = {
        doc_filename: 'report.pdf',
        doc_filesize: 4096,
        doc_url: 'https://cdn/report.pdf',
        doc_blob_path: 'blobs/report.pdf',
        doc_contentType: 'application/pdf',
      }
      const meta = assembleFileMetadata(row, custom, 'documents', parts)
      expect(meta?.metadata).toEqual({
        pathname: 'blobs/report.pdf',
        contentType: 'application/pdf',
      })
      expect(splitFileMetadata(meta, custom, parts)).toEqual(row)
    })
  })

  describe('typed round-trips with real metadata objects', () => {
    it('image: a freshly-uploaded ImageMetadata splits and re-assembles consistently', () => {
      const map = keystoneImageColumnMap('hero')
      const uploaded: ImageMetadata = {
        filename: 'abc123.webp',
        originalFilename: 'hero.webp',
        url: '/uploads/abc123.webp',
        mimeType: 'image/webp',
        size: 2048,
        width: 1200,
        height: 630,
        uploadedAt: new Date().toISOString(),
        storageProvider: 'images',
      }
      const cols = splitImageMetadata(uploaded, map)
      const back = assembleImageMetadata(cols, map, 'images')
      expect(back?.url).toBe(uploaded.url)
      expect(back?.width).toBe(uploaded.width)
      expect(back?.height).toBe(uploaded.height)
      expect(back?.size).toBe(uploaded.size)
      expect(back?.mimeType).toBe(uploaded.mimeType)
      // pathname stores the storage key (our filename).
      expect(back?.filename).toBe(uploaded.filename)
    })

    it('file: a freshly-uploaded FileMetadata splits and re-assembles consistently', () => {
      const map = keystoneFileColumnMap('attachment')
      const uploaded: FileMetadata = {
        filename: 'xyz.pdf',
        originalFilename: 'invoice.pdf',
        url: '/uploads/xyz.pdf',
        mimeType: 'application/pdf',
        size: 9999,
        uploadedAt: new Date().toISOString(),
        storageProvider: 'documents',
      }
      const cols = splitFileMetadata(uploaded, map)
      const back = assembleFileMetadata(cols, map, 'documents')
      expect(back?.url).toBe(uploaded.url)
      expect(back?.size).toBe(uploaded.size)
      expect(back?.filename).toBe(uploaded.filename)
    })
  })
})
