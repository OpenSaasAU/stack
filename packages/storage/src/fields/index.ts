import type {
  BaseFieldConfig,
  TypeInfo,
  MultiColumnPrismaResult,
} from '@opensaas/stack-core/extend'
import { z } from 'zod'
import type { ComponentType } from 'react'
import type { FileMetadata, ImageMetadata, ImageTransformationConfig } from '../config/types.js'
import type { FileValidationOptions } from '../utils/upload.js'
import {
  assembleFileMetadata,
  assembleImageMetadata,
  fileColumnDescriptors,
  fileColumnNames,
  imageColumnDescriptors,
  imageColumnNames,
  resolveFileColumnMap,
  resolveImageColumnMap,
  splitFileMetadata,
  splitImageMetadata,
  type FileColumnMap,
  type ImageColumnMap,
} from '../utils/multi-column.js'

/**
 * Multi-column (Keystone-parity) database mode for image()/file() fields.
 *
 * The default backing for image()/file() is a single `Json?` column. A
 * migrating project that already has a Keystone database can instead set
 * `columns: 'keystone'` to map the field onto the existing per-part columns in
 * place — no destructive migration, no re-upload of existing assets. The
 * per-part column names (used in `@map`) follow Keystone's `<field>_<part>`
 * convention and can be overridden individually. See ADR-0006.
 */
export interface ImageDbConfig {
  /** Custom database column name for single-Json? mode (unused in multi-column mode). */
  map?: string
  /** Override DB-level nullability for single-Json? mode. */
  isNullable?: boolean
  /** Override the native database type for single-Json? mode. */
  nativeType?: string
  /**
   * Enable multi-column mode by setting `'keystone'`. Per-part column-name
   * overrides may be supplied; any omitted part falls back to the Keystone
   * default `<field>_<part>`.
   */
  columns?: 'keystone' | { mode: 'keystone'; map?: Partial<ImageColumnMap> }
}

/**
 * Multi-column (Keystone-parity) database mode for file() fields.
 */
export interface FileDbConfig {
  /** Custom database column name for single-Json? mode (unused in multi-column mode). */
  map?: string
  /** Override DB-level nullability for single-Json? mode. */
  isNullable?: boolean
  /** Override the native database type for single-Json? mode. */
  nativeType?: string
  /**
   * Enable multi-column mode by setting `'keystone'`. Per-part column-name
   * overrides may be supplied; any omitted part falls back to the Keystone
   * default `<field>_<part>`.
   */
  columns?: 'keystone' | { mode: 'keystone'; map?: Partial<FileColumnMap> }
}

/** Whether a field-level `db.columns` option requests multi-column mode. */
function isMultiColumn(columns: ImageDbConfig['columns'] | FileDbConfig['columns']): boolean {
  return columns === 'keystone' || (typeof columns === 'object' && columns?.mode === 'keystone')
}

/** Extract any per-part `@map` overrides from a `db.columns` option. */
function imageColumnOverrides(
  columns: ImageDbConfig['columns'],
): Partial<ImageColumnMap> | undefined {
  return typeof columns === 'object' ? columns.map : undefined
}

function fileColumnOverrides(columns: FileDbConfig['columns']): Partial<FileColumnMap> | undefined {
  return typeof columns === 'object' ? columns.map : undefined
}

/**
 * Detect a File-like input (something we should upload). An already-shaped
 * metadata value or populated multi-column row is authoritative and must never
 * trigger an upload (the no-re-upload guarantee — see ADR-0006).
 */
function isFileLike(value: unknown): value is File {
  return (
    typeof value === 'object' &&
    value !== null &&
    'arrayBuffer' in value &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'
  )
}

/**
 * File field configuration
 */
export interface FileFieldConfig<
  TTypeInfo extends TypeInfo = TypeInfo,
> extends BaseFieldConfig<TTypeInfo> {
  type: 'file'
  /** Name of the storage provider from config.storage */
  storage: string
  /** File validation options */
  validation?: FileValidationOptions
  /** Automatically delete file from storage when record is deleted */
  cleanupOnDelete?: boolean
  /** Automatically delete old file from storage when replaced with new file */
  cleanupOnReplace?: boolean
  /**
   * Database configuration. By default a file is backed by a single `Json?`
   * column; set `db.columns: 'keystone'` to map onto existing Keystone per-part
   * columns in place (non-destructive migration). See ADR-0006.
   */
  db?: FileDbConfig
  /** UI options */
  ui?: {
    /** Custom component to use for rendering this field */
    component?: ComponentType<unknown>
    /** Custom field type name for component registry lookup */
    fieldType?: string
    /** Label for the field */
    label?: string
    /** Help text shown below the field */
    helpText?: string
    /** Placeholder text */
    placeholder?: string
    /** Additional UI options passed through to component */
    [key: string]: unknown
  }
}

/**
 * Image field configuration
 */
export interface ImageFieldConfig<
  TTypeInfo extends TypeInfo = TypeInfo,
> extends BaseFieldConfig<TTypeInfo> {
  type: 'image'
  /** Name of the storage provider from config.storage */
  storage: string
  /** Image transformations to generate on upload */
  transformations?: Record<string, ImageTransformationConfig>
  /** File validation options */
  validation?: FileValidationOptions
  /** Automatically delete file from storage when record is deleted */
  cleanupOnDelete?: boolean
  /** Automatically delete old file from storage when replaced with new file */
  cleanupOnReplace?: boolean
  /**
   * Database configuration. By default an image is backed by a single `Json?`
   * column; set `db.columns: 'keystone'` to map onto existing Keystone per-part
   * columns in place (non-destructive migration). See ADR-0006.
   */
  db?: ImageDbConfig
  /** UI options */
  ui?: {
    /** Custom component to use for rendering this field */
    component?: ComponentType<unknown>
    /** Custom field type name for component registry lookup */
    fieldType?: string
    /** Label for the field */
    label?: string
    /** Help text shown below the field */
    helpText?: string
    /** Placeholder text */
    placeholder?: string
    /** Show image preview */
    showPreview?: boolean
    /** Preview size (width in pixels) */
    previewSize?: number
    /** Additional UI options passed through to component */
    [key: string]: unknown
  }
}

/**
 * Creates a file upload field
 *
 * Uses JSON field backing to store file metadata including filename, URL, size, MIME type, etc.
 *
 * @example
 * ```typescript
 * fields: {
 *   resume: file({
 *     storage: 'documents',
 *     validation: {
 *       maxFileSize: 10 * 1024 * 1024, // 10MB
 *       acceptedMimeTypes: ['application/pdf']
 *     }
 *   })
 * }
 * ```
 */
export function file<TTypeInfo extends TypeInfo = TypeInfo>(
  options: Omit<FileFieldConfig<TTypeInfo>, 'type'>,
): FileFieldConfig<TTypeInfo> {
  const { hooks: userHooks, ...restOptions } = options

  // Multi-column (Keystone-parity) mode maps onto existing per-part columns
  // instead of a single Json? column. The column map is resolved lazily per
  // field name so default `<field>_<part>` names line up with the live columns.
  const multiColumn = isMultiColumn(options.db?.columns)
  const columnMapFor = (fieldName: string): FileColumnMap =>
    resolveFileColumnMap(fieldName, fileColumnOverrides(options.db?.columns))

  const fieldConfig: FileFieldConfig<TTypeInfo> = {
    type: 'file',
    ...restOptions,

    // Override Prisma's Json type with FileMetadata | null in context.db types.
    // Multi-column mode adds the same logical field back via TransformedFields
    // while the raw per-part columns are stripped from the payload.
    resultExtension: {
      outputType: "import('@opensaas/stack-storage').FileMetadata | null",
    },

    hooks: {
      // Keystone-compliant field resolveInput args: the field value lives at
      // `resolvedData[fieldKey]`. See FieldResolveInputHookArgs in core.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field builder hooks are generic and resolved at runtime
      resolveInput: async ({ resolvedData, fieldKey, context, item }: any) => {
        const inputValue = resolvedData?.[fieldKey]

        // If null/undefined, return as-is (deletion or no change)
        if (inputValue === null || inputValue === undefined) {
          return inputValue
        }

        // If already FileMetadata, keep existing (edit mode - no new file
        // uploaded). An existing metadata value is AUTHORITATIVE and must never
        // re-upload. See ADR-0006.
        if (typeof inputValue === 'object' && 'filename' in inputValue && 'url' in inputValue) {
          return inputValue as FileMetadata
        }

        // Only a File-like input triggers an upload.
        if (isFileLike(inputValue)) {
          // Convert File to buffer
          const fileObj = inputValue
          const arrayBuffer = await fileObj.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)

          // Upload file using context.storage utilities
          const metadata = (await context.storage.uploadFile(fieldConfig.storage, fileObj, buffer, {
            validation: fieldConfig.validation,
          })) as FileMetadata

          // If cleanupOnReplace is enabled and there was an old file, delete it
          if (fieldConfig.cleanupOnReplace && item && fieldKey) {
            const oldMetadata = item[fieldKey] as FileMetadata | null
            if (oldMetadata && oldMetadata.filename) {
              try {
                await context.storage.deleteFile(oldMetadata.storageProvider, oldMetadata.filename)
              } catch (error) {
                // Log error but don't fail the operation
                console.error(`Failed to cleanup old file: ${oldMetadata.filename}`, error)
              }
            }
          }

          return metadata
        }

        // Unknown type - return as-is and let validation catch it
        return inputValue
      },

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field builder hooks are generic and resolved at runtime
      afterOperation: async ({ operation, originalItem, fieldKey, context }: any) => {
        // Only cleanup on delete if enabled. The deleted row is `originalItem`.
        if (operation === 'delete' && fieldConfig.cleanupOnDelete) {
          const fileMetadata = originalItem?.[fieldKey] as FileMetadata | null

          if (fileMetadata && typeof fileMetadata === 'object' && fileMetadata.filename) {
            try {
              await context.storage.deleteFile(fileMetadata.storageProvider, fileMetadata.filename)
            } catch (error) {
              // Log error but don't fail the operation
              console.error(`Failed to cleanup file on delete: ${fileMetadata.filename}`, error)
            }
          }
        }
      },
      // Merge with user-provided hooks if any
      ...userHooks,
    },

    getZodSchema: (_fieldName: string, _operation: 'create' | 'update') => {
      // File metadata follows the FileMetadata schema
      const fileMetadataSchema = z.object({
        filename: z.string(),
        originalFilename: z.string(),
        url: z.string(), // Accept both absolute URLs and relative paths
        mimeType: z.string(),
        size: z.number(),
        uploadedAt: z.string(),
        storageProvider: z.string(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })

      // Allow null or undefined values. `.nullish()` (= `.nullable().optional()`)
      // makes the object KEY optional in Zod 4 — a bare union that merely accepts
      // an `undefined` value does NOT (see issue #618, and the #570 precedent in
      // core's validation tests).
      return fileMetadataSchema.nullish()
    },

    getPrismaType: (_fieldName: string) => {
      // Store as JSON in database (single-column default mode).
      return { type: 'Json', modifiers: '?' }
    },

    getTypeScriptType: () => {
      // TypeScript type is FileMetadata | null
      return {
        type: 'FileMetadata | null',
        optional: true,
      }
    },

    getTypeScriptImports: () => {
      return [
        {
          names: ['FileMetadata'],
          from: '@opensaas/stack-storage',
          typeOnly: true,
        },
      ]
    },
  }

  // Multi-column emission + assemble/split. Only attached in multi-column mode
  // so the single-Json? default is completely unaffected.
  if (multiColumn) {
    fieldConfig.getPrismaColumns = (fieldName: string): MultiColumnPrismaResult[] => {
      const map = columnMapFor(fieldName)
      return fileColumnDescriptors(map).map((col) => ({
        name: col.name,
        type: col.type,
        modifiers: '?',
        map: col.map,
      }))
    }
    fieldConfig.getColumnNames = (fieldName: string): string[] =>
      fileColumnNames(columnMapFor(fieldName))
    fieldConfig.assembleColumns = (fieldName: string, row: Record<string, unknown>): unknown =>
      assembleFileMetadata(row, columnMapFor(fieldName), fieldConfig.storage)
    fieldConfig.splitColumns = (fieldName: string, value: unknown): Record<string, unknown> =>
      splitFileMetadata((value ?? null) as FileMetadata | null, columnMapFor(fieldName))
  }

  return fieldConfig
}

/**
 * Creates an image upload field with optional transformations
 *
 * Uses JSON field backing to store image metadata including dimensions, transformations, etc.
 *
 * @example
 * ```typescript
 * fields: {
 *   avatar: image({
 *     storage: 'avatars',
 *     transformations: {
 *       thumbnail: { width: 100, height: 100, fit: 'cover' },
 *       profile: { width: 400, height: 400, fit: 'cover' }
 *     },
 *     validation: {
 *       maxFileSize: 5 * 1024 * 1024, // 5MB
 *       acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
 *     }
 *   })
 * }
 * ```
 */
export function image<TTypeInfo extends TypeInfo = TypeInfo>(
  options: Omit<ImageFieldConfig<TTypeInfo>, 'type'>,
): ImageFieldConfig<TTypeInfo> {
  const { hooks: userHooks, ...restOptions } = options

  // Multi-column (Keystone-parity) mode maps onto existing per-part columns
  // instead of a single Json? column. See ADR-0006.
  const multiColumn = isMultiColumn(options.db?.columns)
  const columnMapFor = (fieldName: string): ImageColumnMap =>
    resolveImageColumnMap(fieldName, imageColumnOverrides(options.db?.columns))

  const fieldConfig: ImageFieldConfig<TTypeInfo> = {
    type: 'image',
    ...restOptions,

    // Override Prisma's Json type with ImageMetadata | null in context.db types.
    // Multi-column mode adds the same logical field back via TransformedFields
    // while the raw per-part columns are stripped from the payload.
    resultExtension: {
      outputType: "import('@opensaas/stack-storage').ImageMetadata | null",
    },

    hooks: {
      // Keystone-compliant field resolveInput args: the field value lives at
      // `resolvedData[fieldKey]`. See FieldResolveInputHookArgs in core.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field builder hooks are generic and resolved at runtime
      resolveInput: async ({ resolvedData, fieldKey, context, item }: any) => {
        const inputValue = resolvedData?.[fieldKey]

        // If null/undefined, return as-is (deletion or no change)
        if (inputValue === null || inputValue === undefined) {
          return inputValue
        }

        // If already ImageMetadata, keep existing (edit mode - no new file
        // uploaded). An existing metadata value is AUTHORITATIVE and must never
        // re-upload. See ADR-0006.
        if (
          typeof inputValue === 'object' &&
          'filename' in inputValue &&
          'url' in inputValue &&
          'width' in inputValue &&
          'height' in inputValue
        ) {
          return inputValue as ImageMetadata
        }

        // Only a File-like input triggers an upload.
        if (isFileLike(inputValue)) {
          // Convert File to buffer
          const fileObj = inputValue
          const arrayBuffer = await fileObj.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)

          // Upload image using context.storage utilities
          const metadata = (await context.storage.uploadImage(
            fieldConfig.storage,
            fileObj,
            buffer,
            {
              validation: fieldConfig.validation,
              transformations: fieldConfig.transformations,
            },
          )) as ImageMetadata

          // If cleanupOnReplace is enabled and there was an old file, delete it
          if (fieldConfig.cleanupOnReplace && item && fieldKey) {
            const oldMetadata = item[fieldKey] as ImageMetadata | null
            if (oldMetadata && oldMetadata.filename) {
              try {
                await context.storage.deleteImage(oldMetadata)
              } catch (error) {
                // Log error but don't fail the operation
                console.error(`Failed to cleanup old image: ${oldMetadata.filename}`, error)
              }
            }
          }

          return metadata
        }

        // Unknown type - return as-is and let validation catch it
        return inputValue
      },

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field builder hooks are generic and resolved at runtime
      afterOperation: async ({ operation, originalItem, fieldKey, context }: any) => {
        // Only cleanup on delete if enabled. The deleted row is `originalItem`.
        if (operation === 'delete' && fieldConfig.cleanupOnDelete) {
          const imageMetadata = originalItem?.[fieldKey] as ImageMetadata | null

          if (imageMetadata && typeof imageMetadata === 'object' && imageMetadata.filename) {
            try {
              await context.storage.deleteImage(imageMetadata)
            } catch (error) {
              // Log error but don't fail the operation
              console.error(`Failed to cleanup image on delete: ${imageMetadata.filename}`, error)
            }
          }
        }
      },
      // Merge with user-provided hooks if any
      ...userHooks,
    },

    getZodSchema: (_fieldName: string, _operation: 'create' | 'update') => {
      // Image metadata follows the ImageMetadata schema (extends FileMetadata)
      const imageMetadataSchema = z.object({
        filename: z.string(),
        originalFilename: z.string(),
        url: z.string(), // Accept both absolute URLs and relative paths
        mimeType: z.string(),
        size: z.number(),
        width: z.number(),
        height: z.number(),
        uploadedAt: z.string(),
        storageProvider: z.string(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        transformations: z
          .record(
            z.string(),
            z.object({
              url: z.string(), // Accept both absolute URLs and relative paths
              width: z.number(),
              height: z.number(),
              size: z.number(),
            }),
          )
          .optional(),
      })

      // Allow null or undefined values. `.nullish()` (= `.nullable().optional()`)
      // makes the object KEY optional in Zod 4 — a bare union that merely accepts
      // an `undefined` value does NOT (see issue #618, and the #570 precedent in
      // core's validation tests).
      return imageMetadataSchema.nullish()
    },

    getPrismaType: (_fieldName: string) => {
      // Store as JSON in database
      return { type: 'Json', modifiers: '?' }
    },

    getTypeScriptType: () => {
      // TypeScript type is ImageMetadata | null
      return {
        type: 'ImageMetadata | null',
        optional: true,
      }
    },

    getTypeScriptImports: () => {
      return [
        {
          names: ['ImageMetadata'],
          from: '@opensaas/stack-storage',
          typeOnly: true,
        },
      ]
    },
  }

  // Multi-column emission + assemble/split. Only attached in multi-column mode
  // so the single-Json? default is completely unaffected.
  if (multiColumn) {
    fieldConfig.getPrismaColumns = (fieldName: string): MultiColumnPrismaResult[] => {
      const map = columnMapFor(fieldName)
      return imageColumnDescriptors(map).map((col) => ({
        name: col.name,
        type: col.type,
        modifiers: '?',
        map: col.map,
      }))
    }
    fieldConfig.getColumnNames = (fieldName: string): string[] =>
      imageColumnNames(columnMapFor(fieldName))
    fieldConfig.assembleColumns = (fieldName: string, row: Record<string, unknown>): unknown =>
      assembleImageMetadata(row, columnMapFor(fieldName), fieldConfig.storage)
    fieldConfig.splitColumns = (fieldName: string, value: unknown): Record<string, unknown> =>
      splitImageMetadata((value ?? null) as ImageMetadata | null, columnMapFor(fieldName))
  }

  return fieldConfig
}
