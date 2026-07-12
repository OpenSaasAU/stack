/**
 * Pure `metadata ↔ columns` mapper for the multi-column (Keystone-parity) mode
 * of the `image()` / `file()` fields.
 *
 * Keystone stores an image across seven per-part columns and a file across
 * three. To adopt a live Keystone database without a destructive migration (see
 * ADR-0006), the storage fields can map onto those existing columns in place,
 * assembling them into an {@link ImageMetadata} / {@link FileMetadata} on read
 * and splitting a metadata value back into columns on write.
 *
 * This module is intentionally pure: no I/O, no storage-provider calls, no
 * dependency on the field builders. It is unit-tested in isolation
 * (`multi-column.test.ts`) and the read/write hooks call it.
 */
import type { FileMetadata, ImageMetadata } from '../config/types.js'

/**
 * The logical "parts" of a Keystone image field. Each maps to one physical
 * column (whose physical name is configurable via `@map`).
 */
export type ImageColumnPart =
  'url' | 'width' | 'height' | 'filesize' | 'contentType' | 'contentDisposition' | 'pathname'

/**
 * The logical "parts" of a Keystone file field.
 */
export type FileColumnPart = 'filename' | 'filesize' | 'url'

/** Ordered list of image parts, matching Keystone's column layout. */
export const IMAGE_COLUMN_PARTS: readonly ImageColumnPart[] = [
  'url',
  'width',
  'height',
  'filesize',
  'contentType',
  'contentDisposition',
  'pathname',
] as const

/** Ordered list of file parts, matching Keystone's column layout. */
export const FILE_COLUMN_PARTS: readonly FileColumnPart[] = ['filename', 'filesize', 'url'] as const

/** The Prisma scalar type each image part is stored as. */
const IMAGE_PART_PRISMA_TYPE: Record<ImageColumnPart, 'String' | 'Int'> = {
  url: 'String',
  width: 'Int',
  height: 'Int',
  filesize: 'Int',
  contentType: 'String',
  contentDisposition: 'String',
  pathname: 'String',
}

/** The Prisma scalar type each file part is stored as. */
const FILE_PART_PRISMA_TYPE: Record<FileColumnPart, 'String' | 'Int'> = {
  filename: 'String',
  filesize: 'Int',
  url: 'String',
}

/**
 * Map of image part → physical column name (the value used in `@map`).
 * Defaults follow Keystone's `<field>_<part>` naming.
 */
export type ImageColumnMap = Record<ImageColumnPart, string>

/** Map of file part → physical column name. */
export type FileColumnMap = Record<FileColumnPart, string>

/** A single physical column to emit for a multi-column field. */
export interface MultiColumnDescriptor {
  /** The Prisma model field name (the property carrying `@map`). */
  name: string
  /** The Prisma scalar type. */
  type: 'String' | 'Int'
  /** The physical column name used in `@map`. */
  map: string
}

/**
 * Build the default per-part column-name map for an image field, following
 * Keystone's `<field>_<part>` convention.
 *
 * @example
 * keystoneImageColumnMap('image') // { url: 'image_url', width: 'image_width', ... }
 */
export function keystoneImageColumnMap(fieldName: string): ImageColumnMap {
  return {
    url: `${fieldName}_url`,
    width: `${fieldName}_width`,
    height: `${fieldName}_height`,
    filesize: `${fieldName}_filesize`,
    contentType: `${fieldName}_contentType`,
    contentDisposition: `${fieldName}_contentDisposition`,
    pathname: `${fieldName}_pathname`,
  }
}

/**
 * Build the default per-part column-name map for a file field.
 *
 * @example
 * keystoneFileColumnMap('file') // { filename: 'file_filename', filesize: 'file_filesize', url: 'file_url' }
 */
export function keystoneFileColumnMap(fieldName: string): FileColumnMap {
  return {
    filename: `${fieldName}_filename`,
    filesize: `${fieldName}_filesize`,
    url: `${fieldName}_url`,
  }
}

/**
 * Resolve the effective image column map: defaults from {@link keystoneImageColumnMap},
 * with any caller-supplied per-part overrides applied on top.
 */
export function resolveImageColumnMap(
  fieldName: string,
  overrides?: Partial<ImageColumnMap>,
): ImageColumnMap {
  return { ...keystoneImageColumnMap(fieldName), ...overrides }
}

/**
 * Resolve the effective file column map.
 */
export function resolveFileColumnMap(
  fieldName: string,
  overrides?: Partial<FileColumnMap>,
): FileColumnMap {
  return { ...keystoneFileColumnMap(fieldName), ...overrides }
}

/**
 * The Prisma model field name carrying a given image part's column. We name the
 * model field after the physical column itself (i.e. `<field>_url`) so the
 * generated property and its `@map` line up with the live Keystone column.
 */
function imagePartFieldName(map: ImageColumnMap, part: ImageColumnPart): string {
  return map[part]
}

function filePartFieldName(map: FileColumnMap, part: FileColumnPart): string {
  return map[part]
}

/**
 * Describe the physical columns an image field emits in multi-column mode.
 * Each descriptor's `name` is the Prisma model field name and `map` is the
 * physical column it maps to (here they are identical so the schema reads
 * naturally over the live columns).
 */
export function imageColumnDescriptors(map: ImageColumnMap): MultiColumnDescriptor[] {
  return IMAGE_COLUMN_PARTS.map((part) => ({
    name: imagePartFieldName(map, part),
    type: IMAGE_PART_PRISMA_TYPE[part],
    map: map[part],
  }))
}

/**
 * Describe the physical columns a file field emits in multi-column mode.
 */
export function fileColumnDescriptors(map: FileColumnMap): MultiColumnDescriptor[] {
  return FILE_COLUMN_PARTS.map((part) => ({
    name: filePartFieldName(map, part),
    type: FILE_PART_PRISMA_TYPE[part],
    map: map[part],
  }))
}

/** The physical column field names an image field owns (for read stripping). */
export function imageColumnNames(map: ImageColumnMap): string[] {
  return IMAGE_COLUMN_PARTS.map((part) => imagePartFieldName(map, part))
}

/** The physical column field names a file field owns (for read stripping). */
export function fileColumnNames(map: FileColumnMap): string[] {
  return FILE_COLUMN_PARTS.map((part) => filePartFieldName(map, part))
}

/** Coerce an unknown column value to a string, or `null` when absent/empty. */
function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  return String(value)
}

/** Coerce an unknown column value to a number, or `null` when absent/invalid. */
function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  if (typeof value === 'bigint') return Number(value)
  return null
}

/**
 * Assemble the per-part image columns from a database row into an
 * {@link ImageMetadata}.
 *
 * Returns `null` when the row carries no image at all (the `url` column is the
 * authoritative presence signal — Keystone leaves every part NULL for an empty
 * image). Partially-populated rows (e.g. only `image_url`) still assemble into a
 * valid object, with missing scalar parts defaulted (width/height/size → 0).
 *
 * `storageProvider` is supplied by the caller (the field knows which provider it
 * is bound to); legacy columns do not carry it.
 */
export function assembleImageMetadata(
  row: Record<string, unknown>,
  map: ImageColumnMap,
  storageProvider: string,
): ImageMetadata | null {
  const url = asString(row[map.url])
  if (url === null || url === '') {
    return null
  }

  const pathname = asString(row[map.pathname])
  const contentType = asString(row[map.contentType])
  const contentDisposition = asString(row[map.contentDisposition])

  // Keystone stores the storage key in `pathname`; fall back to the URL when
  // absent so `filename` is always populated.
  const filename = pathname ?? url

  const metadata: ImageMetadata = {
    filename,
    originalFilename: filename,
    url,
    mimeType: contentType ?? 'application/octet-stream',
    size: asNumber(row[map.filesize]) ?? 0,
    width: asNumber(row[map.width]) ?? 0,
    height: asNumber(row[map.height]) ?? 0,
    uploadedAt: '',
    storageProvider,
  }

  // Preserve the Keystone-only content disposition (no first-class metadata
  // field) so a round-trip back to columns does not lose it.
  if (contentDisposition !== null) {
    metadata.metadata = { contentDisposition }
  }

  return metadata
}

/**
 * Split an {@link ImageMetadata} (or `null`) back into the per-part image
 * columns for writing. A `null`/`undefined` metadata clears every column.
 */
export function splitImageMetadata(
  metadata: ImageMetadata | null | undefined,
  map: ImageColumnMap,
): Record<string, string | number | null> {
  if (metadata === null || metadata === undefined) {
    return {
      [map.url]: null,
      [map.width]: null,
      [map.height]: null,
      [map.filesize]: null,
      [map.contentType]: null,
      [map.contentDisposition]: null,
      [map.pathname]: null,
    }
  }

  const contentDisposition =
    metadata.metadata && typeof metadata.metadata.contentDisposition === 'string'
      ? metadata.metadata.contentDisposition
      : null

  return {
    [map.url]: metadata.url,
    [map.width]: metadata.width ?? null,
    [map.height]: metadata.height ?? null,
    [map.filesize]: metadata.size ?? null,
    [map.contentType]: metadata.mimeType ?? null,
    [map.contentDisposition]: contentDisposition,
    // Keystone's pathname holds the storage key (our `filename`).
    [map.pathname]: metadata.filename ?? null,
  }
}

/**
 * Assemble the per-part file columns from a database row into a
 * {@link FileMetadata}. Returns `null` when no file is present.
 */
export function assembleFileMetadata(
  row: Record<string, unknown>,
  map: FileColumnMap,
  storageProvider: string,
): FileMetadata | null {
  const url = asString(row[map.url])
  const filename = asString(row[map.filename])

  // Either a URL or a filename signals a present file.
  if ((url === null || url === '') && (filename === null || filename === '')) {
    return null
  }

  const resolvedFilename = filename ?? url ?? ''

  return {
    filename: resolvedFilename,
    originalFilename: resolvedFilename,
    url: url ?? '',
    mimeType: 'application/octet-stream',
    size: asNumber(row[map.filesize]) ?? 0,
    uploadedAt: '',
    storageProvider,
  }
}

/**
 * Split a {@link FileMetadata} (or `null`) back into the per-part file columns
 * for writing. A `null`/`undefined` metadata clears every column.
 */
export function splitFileMetadata(
  metadata: FileMetadata | null | undefined,
  map: FileColumnMap,
): Record<string, string | number | null> {
  if (metadata === null || metadata === undefined) {
    return {
      [map.filename]: null,
      [map.filesize]: null,
      [map.url]: null,
    }
  }

  return {
    [map.filename]: metadata.filename ?? null,
    [map.filesize]: metadata.size ?? null,
    [map.url]: metadata.url ?? null,
  }
}
