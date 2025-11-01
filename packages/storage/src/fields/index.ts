import type { BaseFieldConfig } from '@opensaas/stack-core'
import { z } from 'zod'
import type { ComponentType } from 'react'
import type {
  FileMetadata,
  ImageMetadata,
  ImageTransformationConfig,
} from '../config/types.js'
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
  /** UI options */
  ui?: {
    /** Custom component to use for rendering this field */
    component?: ComponentType<any>
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
export interface ImageFieldConfig extends BaseFieldConfig<ImageMetadata | null, ImageMetadata | null> {
  type: 'image'
  /** Name of the storage provider from config.storage */
  storage: string
  /** Image transformations to generate on upload */
  transformations?: Record<string, ImageTransformationConfig>
  /** File validation options */
  validation?: FileValidationOptions
  /** UI options */
  ui?: {
    /** Custom component to use for rendering this field */
    component?: ComponentType<any>
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
  return {
    type: 'file',
    ...options,

    getZodSchema: (fieldName: string, operation: 'create' | 'update') => {
      // File metadata follows the FileMetadata schema
      const fileMetadataSchema = z.object({
        filename: z.string(),
        originalFilename: z.string(),
        url: z.string().url(),
        mimeType: z.string(),
        size: z.number(),
        uploadedAt: z.string(),
        storageProvider: z.string(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })

      // Allow null or undefined values
      return z.union([fileMetadataSchema, z.null(), z.undefined()])
    },

    getPrismaType: (fieldName: string) => {
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
  return {
    type: 'image',
    ...options,

    getZodSchema: (fieldName: string, operation: 'create' | 'update') => {
      // Image metadata follows the ImageMetadata schema (extends FileMetadata)
      const imageMetadataSchema = z.object({
        filename: z.string(),
        originalFilename: z.string(),
        url: z.string().url(),
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
              url: z.string().url(),
              width: z.number(),
              height: z.number(),
              size: z.number(),
            })
          )
          .optional(),
      })

      // Allow null or undefined values
      return z.union([imageMetadataSchema, z.null(), z.undefined()])
    },

    getPrismaType: (fieldName: string) => {
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
}
