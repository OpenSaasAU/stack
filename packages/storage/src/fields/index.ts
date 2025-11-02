import type { BaseFieldConfig } from '@opensaas/stack-core'
import { z } from 'zod'
import type { ComponentType } from 'react'
import type { FileMetadata, ImageMetadata, ImageTransformationConfig } from '../config/types.js'
import type { FileValidationOptions } from '../utils/upload.js'

/**
 * File field configuration
 */
export interface FileFieldConfig extends BaseFieldConfig<FileMetadata | null, FileMetadata | null> {
  type: 'file'
  /** Name of the storage provider from config.storage */
  storage: string
  /** File validation options */
  validation?: FileValidationOptions
  /** Automatically delete file from storage when record is deleted */
  cleanupOnDelete?: boolean
  /** Automatically delete old file from storage when replaced with new file */
  cleanupOnReplace?: boolean
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
export interface ImageFieldConfig
  extends BaseFieldConfig<ImageMetadata | null, ImageMetadata | null> {
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
export function file(options: Omit<FileFieldConfig, 'type'>): FileFieldConfig {
  const fieldConfig: FileFieldConfig = {
    type: 'file',
    ...options,

    hooks: {
      resolveInput: async ({ inputValue, context, item, fieldName }) => {
        // If null/undefined, return as-is (deletion or no change)
        if (inputValue === null || inputValue === undefined) {
          return inputValue
        }

        // If already FileMetadata, keep existing (edit mode - no new file uploaded)
        if (typeof inputValue === 'object' && 'filename' in inputValue && 'url' in inputValue) {
          return inputValue as FileMetadata
        }

        // If File object, upload it
        // Check if it's a File-like object (has arrayBuffer method)
        if (
          typeof inputValue === 'object' &&
          'arrayBuffer' in inputValue &&
          typeof (inputValue as { arrayBuffer?: unknown }).arrayBuffer === 'function'
        ) {
          // Convert File to buffer
          const fileObj = inputValue as File
          const arrayBuffer = await fileObj.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)

          // Upload file using context.storage utilities
          const metadata = (await context.storage.uploadFile(fieldConfig.storage, fileObj, buffer, {
            validation: fieldConfig.validation,
          })) as FileMetadata

          // If cleanupOnReplace is enabled and there was an old file, delete it
          if (fieldConfig.cleanupOnReplace && item && fieldName) {
            const oldMetadata = item[fieldName] as FileMetadata | null
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

      afterOperation: async ({ operation, item, fieldName, context }) => {
        // Only cleanup on delete if enabled
        if (operation === 'delete' && fieldConfig.cleanupOnDelete) {
          const fileMetadata = item[fieldName] as FileMetadata | null

          if (fileMetadata && fileMetadata.filename) {
            try {
              await context.storage.deleteFile(fileMetadata.storageProvider, fileMetadata.filename)
            } catch (error) {
              // Log error but don't fail the operation
              console.error(`Failed to cleanup file on delete: ${fileMetadata.filename}`, error)
            }
          }
        }
      },
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

      // Allow null or undefined values
      return z.union([fileMetadataSchema, z.null(), z.undefined()])
    },

    getPrismaType: (_fieldName: string) => {
      // Store as JSON in database
      return { type: 'Json', modifiers: '?' }
    },

    getTypeScriptType: () => {
      // TypeScript type is FileMetadata | null
      return {
        type: 'import("@opensaas/stack-storage").FileMetadata | null',
        optional: true,
      }
    },
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
export function image(options: Omit<ImageFieldConfig, 'type'>): ImageFieldConfig {
  const fieldConfig: ImageFieldConfig = {
    type: 'image',
    ...options,

    hooks: {
      resolveInput: async ({ inputValue, context, item, fieldName }) => {
        // If null/undefined, return as-is (deletion or no change)
        if (inputValue === null || inputValue === undefined) {
          return inputValue
        }

        // If already ImageMetadata, keep existing (edit mode - no new file uploaded)
        if (
          typeof inputValue === 'object' &&
          'filename' in inputValue &&
          'url' in inputValue &&
          'width' in inputValue &&
          'height' in inputValue
        ) {
          return inputValue as ImageMetadata
        }

        // If File object, upload it
        // Check if it's a File-like object (has arrayBuffer method)
        if (
          typeof inputValue === 'object' &&
          'arrayBuffer' in inputValue &&
          typeof (inputValue as { arrayBuffer?: unknown }).arrayBuffer === 'function'
        ) {
          // Convert File to buffer
          const fileObj = inputValue as File
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
          if (fieldConfig.cleanupOnReplace && item && fieldName) {
            const oldMetadata = item[fieldName] as ImageMetadata | null
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

      afterOperation: async ({ operation, item, fieldName, context }) => {
        // Only cleanup on delete if enabled
        if (operation === 'delete' && fieldConfig.cleanupOnDelete) {
          const imageMetadata = item[fieldName] as ImageMetadata | null

          if (imageMetadata && imageMetadata.filename) {
            try {
              await context.storage.deleteImage(imageMetadata)
            } catch (error) {
              // Log error but don't fail the operation
              console.error(`Failed to cleanup image on delete: ${imageMetadata.filename}`, error)
            }
          }
        }
      },
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

      // Allow null or undefined values
      return z.union([imageMetadataSchema, z.null(), z.undefined()])
    },

    getPrismaType: (_fieldName: string) => {
      // Store as JSON in database
      return { type: 'Json', modifiers: '?' }
    },

    getTypeScriptType: () => {
      // TypeScript type is ImageMetadata | null
      return {
        type: 'import("@opensaas/stack-storage").ImageMetadata | null',
        optional: true,
      }
    },
  }

  return fieldConfig
}
