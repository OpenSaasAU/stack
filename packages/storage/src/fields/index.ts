import type {
  BaseFieldConfig,
  ContractColumnDescriptor,
  ContractFieldDescriptor,
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
  DEFAULT_FILE_COLUMN_PARTS,
  fileColumnDescriptors,
  fileColumnNames,
  imageColumnDescriptors,
  imageColumnNames,
  resolveFileColumnMap,
  resolveImageColumnMap,
  splitFileMetadata,
  splitImageMetadata,
  type FileColumnMap,
  type FileColumnPart,
  type ImageColumnMap,
  type MultiColumnDescriptor,
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
  /** Override DB-level nullability for single-Json? mode; refused alongside `columns`. */
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
  /** Override DB-level nullability for single-Json? mode; refused alongside `columns`. */
  isNullable?: boolean
  /** Override the native database type for single-Json? mode. */
  nativeType?: string
  /**
   * Enable multi-column mode by setting `'keystone'`. Per-part column-name
   * overrides may be supplied; any omitted part falls back to the Keystone
   * default `<field>_<part>`.
   *
   * By default only `filename`/`filesize`/`url` are emitted. Pass `parts` to
   * additionally opt into the `pathname`/`contentType` Keystone-parity
   * extras (e.g. `parts: FILE_COLUMN_PARTS` for all five, or a custom subset)
   * — see {@link FILE_COLUMN_PARTS} / {@link DEFAULT_FILE_COLUMN_PARTS}.
   */
  columns?:
    | 'keystone'
    | { mode: 'keystone'; map?: Partial<FileColumnMap>; parts?: readonly FileColumnPart[] }
}

function isMultiColumn(columns: ImageDbConfig['columns'] | FileDbConfig['columns']): boolean {
  return columns === 'keystone' || (typeof columns === 'object' && columns?.mode === 'keystone')
}

/**
 * Nullability is ONE decision, shared by the emitted column, the declared
 * TypeScript face and the Zod schema. Splitting them lets `db.isNullable: false`
 * emit a NOT NULL column while the face and schema still admit `null`, so
 * `create({ data: { field: null } })` type-checks, validates, and then dies on a
 * not-null violation. Multi-column mode has no single column to constrain —
 * every part column is nullable — so the assembled metadata is always nullable.
 */
function resolveNullable(db: ImageDbConfig | FileDbConfig | undefined): boolean {
  return isMultiColumn(db?.columns) ? true : (db?.isNullable ?? true)
}

/**
 * Refuse `db.isNullable: false` alongside multi-column mode.
 *
 * Thrown from `getContractField`, which core's `validateExtensionPacks` calls
 * inside a try/catch and reports as a `field-descriptor-error` config refusal
 * naming the list and the field — so generation stops before any column is
 * emitted. Core cannot make this call itself: another field package may
 * legitimately consume `db.isNullable` when building its part columns, and only
 * the package that drops the option knows that it drops it.
 */
function refuseNullabilityOverride(db: ImageDbConfig | FileDbConfig | undefined): void {
  if (db?.isNullable !== false) return
  throw new Error(
    'db.isNullable: false is set alongside db.columns (multi-column, Keystone-parity mode), ' +
      'where every part column is nullable and an all-NULL row reads back as null — the ' +
      'assembled value cannot be non-nullable. Remove db.isNullable, or remove db.columns to ' +
      'use the single-Json? column that db.isNullable constrains.',
  )
}

/** The metadata blob's single-column backing, honouring the `db` overrides the field documents. */
function metadataColumn(
  fieldName: string,
  db: ImageDbConfig | FileDbConfig | undefined,
): ContractFieldDescriptor {
  const descriptor: { kind: 'column' } & ContractColumnDescriptor = {
    kind: 'column',
    name: fieldName,
    type: { pack: 'pg', type: 'jsonb' },
    nullable: resolveNullable(db),
  }
  if (db?.nativeType !== undefined) descriptor.nativeType = db.nativeType
  if (db?.map !== undefined) descriptor.map = db.map
  return descriptor
}

/** The `outputType`/`inputType` faces for a metadata field, following its column's nullability. */
function metadataFaces(
  metadataType: string,
  nullable: boolean,
): { outputType: string; inputType: string } {
  const suffix = nullable ? ' | null' : ''
  return {
    outputType: `${metadataType}${suffix}`,
    inputType: `File | ${metadataType}${suffix}`,
  }
}

/**
 * Apply a field's nullability to its metadata Zod schema. A non-nullable column
 * rejects `null` outright; `undefined` is still allowed on update so partial
 * updates need not restate the field.
 */
function applyNullability(
  schema: z.ZodTypeAny,
  nullable: boolean,
  operation: 'create' | 'update',
): z.ZodTypeAny {
  // `.nullish()` (= `.nullable().optional()`) makes the object KEY optional in
  // Zod 4 — a bare union that merely accepts an `undefined` value does NOT
  // (see issue #618, and the #570 precedent in core's validation tests).
  if (nullable) return schema.nullish()
  return operation === 'create' ? schema : schema.optional()
}

/**
 * The per-part columns of a multi-column field, as the contract spells them.
 * The model field name and the physical column are the same string here (see
 * `imagePartFieldName` in `../utils/multi-column.js`), so no `map` is carried.
 */
function partColumns(parts: readonly MultiColumnDescriptor[]): ContractFieldDescriptor {
  return {
    kind: 'columns',
    columns: parts.map((part) => ({
      name: part.name,
      type: { pack: 'pg', type: part.type === 'Int' ? 'int' : 'text' },
      nullable: true,
    })),
  }
}

function imageColumnOverrides(
  columns: ImageDbConfig['columns'],
): Partial<ImageColumnMap> | undefined {
  return typeof columns === 'object' ? columns.map : undefined
}

function fileColumnOverrides(columns: FileDbConfig['columns']): Partial<FileColumnMap> | undefined {
  return typeof columns === 'object' ? columns.map : undefined
}

function fileColumnPartsFor(columns: FileDbConfig['columns']): readonly FileColumnPart[] {
  return typeof columns === 'object' && columns.parts ? columns.parts : DEFAULT_FILE_COLUMN_PARTS
}

/**
 * An already-shaped metadata value or populated multi-column row is
 * authoritative and must never trigger a re-upload (the no-re-upload
 * guarantee — see ADR-0006).
 */
function isFileLike(value: unknown): value is File {
  return (
    typeof value === 'object' &&
    value !== null &&
    'arrayBuffer' in value &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'
  )
}

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
  /** Database configuration; see {@link FileDbConfig} for multi-column mode. */
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
  /** Database configuration; see {@link ImageDbConfig} for multi-column mode. */
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

  // Column map resolves lazily per field name so default `<field>_<part>`
  // names line up with the live columns.
  const multiColumn = isMultiColumn(options.db?.columns)
  const columnMapFor = (fieldName: string): FileColumnMap =>
    resolveFileColumnMap(fieldName, fileColumnOverrides(options.db?.columns))
  const fileParts: readonly FileColumnPart[] = fileColumnPartsFor(options.db?.columns)
  const nullable = resolveNullable(options.db)
  const faces = metadataFaces("import('@opensaas/stack-storage').FileMetadata", nullable)

  const fieldConfig: FileFieldConfig<TTypeInfo> = {
    type: 'file',
    outputType: faces.outputType,
    inputType: faces.inputType,
    ...restOptions,

    // Override Prisma's Json type with FileMetadata | null in context.db types.
    // Multi-column mode adds the same logical field back via TransformedFields
    // while the raw per-part columns are stripped from the payload.
    resultExtension: {
      outputType: faces.outputType,
    },

    hooks: {
      // Keystone-compliant field resolveInput args: the field value lives at
      // `resolvedData[fieldKey]`. See FieldResolveInputHookArgs in core.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field builder hooks are generic and resolved at runtime
      resolveInput: async ({ resolvedData, fieldKey, context, item }: any) => {
        const inputValue = resolvedData?.[fieldKey]

        if (inputValue === null || inputValue === undefined) {
          return inputValue
        }

        // An existing metadata value is AUTHORITATIVE and must never
        // re-upload. See ADR-0006.
        if (typeof inputValue === 'object' && 'filename' in inputValue && 'url' in inputValue) {
          return inputValue as FileMetadata
        }

        if (isFileLike(inputValue)) {
          const fileObj = inputValue
          const arrayBuffer = await fileObj.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)

          const metadata = (await context.storage.uploadFile(fieldConfig.storage, fileObj, buffer, {
            validation: fieldConfig.validation,
          })) as FileMetadata

          if (fieldConfig.cleanupOnReplace && item && fieldKey) {
            const oldMetadata = item[fieldKey] as FileMetadata | null
            if (oldMetadata && oldMetadata.filename) {
              try {
                await context.storage.deleteFile(oldMetadata.storageProvider, oldMetadata.filename)
              } catch (error) {
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
        // The deleted row is `originalItem`.
        if (operation === 'delete' && fieldConfig.cleanupOnDelete) {
          const fileMetadata = originalItem?.[fieldKey] as FileMetadata | null

          if (fileMetadata && typeof fileMetadata === 'object' && fileMetadata.filename) {
            try {
              await context.storage.deleteFile(fileMetadata.storageProvider, fileMetadata.filename)
            } catch (error) {
              console.error(`Failed to cleanup file on delete: ${fileMetadata.filename}`, error)
            }
          }
        }
      },
      ...userHooks,
    },

    getZodSchema: (_fieldName: string, operation: 'create' | 'update') => {
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

      return applyNullability(fileMetadataSchema, nullable, operation)
    },

    getPrismaType: (_fieldName: string) => {
      return { type: 'Json', modifiers: '?' }
    },

    getContractField: (fieldName: string): ContractFieldDescriptor =>
      metadataColumn(fieldName, options.db),

    getTypeScriptType: () => {
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

  // Only attached in multi-column mode; the single-Json? default is unaffected.
  if (multiColumn) {
    fieldConfig.getPrismaColumns = (fieldName: string): MultiColumnPrismaResult[] => {
      const map = columnMapFor(fieldName)
      return fileColumnDescriptors(map, fileParts).map((col) => ({
        name: col.name,
        type: col.type,
        modifiers: '?',
        map: col.map,
      }))
    }
    fieldConfig.getContractField = (fieldName: string): ContractFieldDescriptor => {
      refuseNullabilityOverride(options.db)
      return partColumns(fileColumnDescriptors(columnMapFor(fieldName), fileParts))
    }
    fieldConfig.getColumnNames = (fieldName: string): string[] =>
      fileColumnNames(columnMapFor(fieldName), fileParts)
    fieldConfig.assembleColumns = (fieldName: string, row: Record<string, unknown>): unknown =>
      assembleFileMetadata(row, columnMapFor(fieldName), fieldConfig.storage, fileParts)
    fieldConfig.splitColumns = (fieldName: string, value: unknown): Record<string, unknown> =>
      splitFileMetadata((value ?? null) as FileMetadata | null, columnMapFor(fieldName), fileParts)
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

  // See ADR-0006.
  const multiColumn = isMultiColumn(options.db?.columns)
  const columnMapFor = (fieldName: string): ImageColumnMap =>
    resolveImageColumnMap(fieldName, imageColumnOverrides(options.db?.columns))
  const nullable = resolveNullable(options.db)
  const faces = metadataFaces("import('@opensaas/stack-storage').ImageMetadata", nullable)

  const fieldConfig: ImageFieldConfig<TTypeInfo> = {
    type: 'image',
    outputType: faces.outputType,
    inputType: faces.inputType,
    ...restOptions,

    // Override Prisma's Json type with ImageMetadata | null in context.db types.
    // Multi-column mode adds the same logical field back via TransformedFields
    // while the raw per-part columns are stripped from the payload.
    resultExtension: {
      outputType: faces.outputType,
    },

    hooks: {
      // Keystone-compliant field resolveInput args: the field value lives at
      // `resolvedData[fieldKey]`. See FieldResolveInputHookArgs in core.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field builder hooks are generic and resolved at runtime
      resolveInput: async ({ resolvedData, fieldKey, context, item }: any) => {
        const inputValue = resolvedData?.[fieldKey]

        if (inputValue === null || inputValue === undefined) {
          return inputValue
        }

        // An existing metadata value is AUTHORITATIVE and must never
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

        if (isFileLike(inputValue)) {
          const fileObj = inputValue
          const arrayBuffer = await fileObj.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)

          const metadata = (await context.storage.uploadImage(
            fieldConfig.storage,
            fileObj,
            buffer,
            {
              validation: fieldConfig.validation,
              transformations: fieldConfig.transformations,
            },
          )) as ImageMetadata

          if (fieldConfig.cleanupOnReplace && item && fieldKey) {
            const oldMetadata = item[fieldKey] as ImageMetadata | null
            if (oldMetadata && oldMetadata.filename) {
              try {
                await context.storage.deleteImage(oldMetadata)
              } catch (error) {
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
        // The deleted row is `originalItem`.
        if (operation === 'delete' && fieldConfig.cleanupOnDelete) {
          const imageMetadata = originalItem?.[fieldKey] as ImageMetadata | null

          if (imageMetadata && typeof imageMetadata === 'object' && imageMetadata.filename) {
            try {
              await context.storage.deleteImage(imageMetadata)
            } catch (error) {
              console.error(`Failed to cleanup image on delete: ${imageMetadata.filename}`, error)
            }
          }
        }
      },
      ...userHooks,
    },

    getZodSchema: (_fieldName: string, operation: 'create' | 'update') => {
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

      return applyNullability(imageMetadataSchema, nullable, operation)
    },

    getPrismaType: (_fieldName: string) => {
      return { type: 'Json', modifiers: '?' }
    },

    getContractField: (fieldName: string): ContractFieldDescriptor =>
      metadataColumn(fieldName, options.db),

    getTypeScriptType: () => {
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

  // Only attached in multi-column mode; the single-Json? default is unaffected.
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
    fieldConfig.getContractField = (fieldName: string): ContractFieldDescriptor => {
      refuseNullabilityOverride(options.db)
      return partColumns(imageColumnDescriptors(columnMapFor(fieldName)))
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
