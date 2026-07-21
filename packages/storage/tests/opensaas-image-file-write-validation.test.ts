import { describe, it, expect, vi } from 'vitest'
import { ValidationError, type FieldConfig } from '@opensaas/stack-core'
import { validateWithZod } from '@opensaas/stack-core/internal'
import { image, file } from '../src/fields/index.js'
import type { ImageMetadata, FileMetadata } from '../src/config/types.js'

/**
 * End-to-end regression coverage for #789/#790: a wrong-shape write value for
 * an `image()`/`file()` field must be rejected by validation instead of being
 * silently split into null/undefined physical columns.
 *
 * This exercises the REAL field pipeline pieces in the order the Hook
 * Pipeline runs them (see `packages/core/src/context/hook-pipeline.ts`):
 *
 *   field `resolveInput` → built-in field rules → `splitColumns`
 *
 * `runValidateFieldRules` below mirrors core's `validateFieldRules`
 * (`packages/core/src/hooks/index.ts`) — itself a thin formatting wrapper
 * over the public `validateWithZod` export — so this test validates against
 * the exact Zod schema (`field.getZodSchema`) Phase 3 of the real pipeline
 * runs, and throws the real `ValidationError` class on failure. `splitColumns`
 * is only invoked when that validation passes, matching the #789 phase order
 * (validate the LOGICAL value before splitting into physical columns).
 */

/** A File-like stub with an arrayBuffer() method (triggers an upload). */
function fakeFile(bytes = [1, 2, 3]): File {
  return {
    name: 'photo.png',
    type: 'image/png',
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as unknown as File
}

/**
 * The legacy Keystone GraphQL upload wrapper shape (`{ upload: File }`). It
 * has neither `.arrayBuffer()` (so it isn't File-like) nor `filename`/`url`
 * keys (so it doesn't look like already-shaped metadata either) — the
 * unrecognised shape that reproduces the original silent-corruption bug.
 */
function legacyUploadWrapper(): unknown {
  return { upload: fakeFile() }
}

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

/** Mirrors core's `validateFieldRules` — throws the real `ValidationError` on failure. */
function runValidateFieldRules(
  data: Record<string, unknown>,
  fieldConfigs: Record<string, FieldConfig>,
  operation: 'create' | 'update',
): void {
  const result = validateWithZod(data, fieldConfigs, operation)
  if (!result.success) {
    throw new ValidationError(Object.values(result.errors), result.errors)
  }
}

/**
 * Runs the real resolveInput → validate → splitColumns sequence for one field
 * and one input value, in that order. `splitColumns` is only reached if
 * validation does not throw — exactly the #789 phase order.
 */
async function resolveValidateAndSplit(
  field: FieldConfig,
  fieldKey: string,
  operation: 'create' | 'update',
  inputValue: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper threads through a minimal context stub
  context: any,
  item?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resolved = await field.hooks!.resolveInput!({
    listKey: 'Post',
    fieldKey,
    operation,
    inputData: { [fieldKey]: inputValue },
    item,
    resolvedData: { [fieldKey]: inputValue },
    context,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

  runValidateFieldRules({ [fieldKey]: resolved }, { [fieldKey]: field }, operation)

  return field.splitColumns!(fieldKey, resolved)
}

describe('image()/file() write validation matrix (#790)', () => {
  describe('db.columns: "keystone" (multi-column) mode', () => {
    describe('image()', () => {
      const field = image({ storage: 'images', db: { columns: 'keystone' } })

      it('rejects the legacy Keystone upload-wrapper shape with a thrown ValidationError', async () => {
        const { context } = makeContext()
        const splitSpy = vi.spyOn(field, 'splitColumns')

        await expect(
          resolveValidateAndSplit(field, 'image', 'create', legacyUploadWrapper(), context),
        ).rejects.toThrow(ValidationError)

        // splitColumns must never run once validation has rejected the value —
        // this is the exact mechanism that used to silently corrupt data.
        expect(splitSpy).not.toHaveBeenCalled()
      })

      it('clears every column for a null value', async () => {
        const { context } = makeContext()
        const columns = await resolveValidateAndSplit(field, 'image', 'update', null, context)
        expect(columns).toEqual({
          image_url: null,
          image_width: null,
          image_height: null,
          image_filesize: null,
          image_contentType: null,
          image_contentDisposition: null,
          image_pathname: null,
        })
      })

      it('keeps an already-shaped ImageMetadata unchanged (no re-upload) and splits it', async () => {
        const { context, uploadImage } = makeContext()
        const existing: ImageMetadata = {
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
        const columns = await resolveValidateAndSplit(field, 'image', 'update', existing, context, {
          image: existing,
        })
        expect(uploadImage).not.toHaveBeenCalled()
        expect(columns).toEqual({
          image_url: '/u/a.jpg',
          image_width: 100,
          image_height: 50,
          image_filesize: 1024,
          image_contentType: 'image/jpeg',
          image_contentDisposition: null,
          image_pathname: 'a.jpg',
        })
      })

      it('uploads a File-like value and splits the returned metadata', async () => {
        const { context, uploadImage } = makeContext()
        const columns = await resolveValidateAndSplit(field, 'image', 'create', fakeFile(), context)
        expect(uploadImage).toHaveBeenCalledTimes(1)
        expect(columns).toMatchObject({
          image_url: '/uploads/new.png',
          image_width: 10,
          image_height: 10,
          image_filesize: 3,
          image_contentType: 'image/png',
        })
      })
    })

    describe('file()', () => {
      const field = file({ storage: 'documents', db: { columns: 'keystone' } })

      it('rejects the legacy Keystone upload-wrapper shape with a thrown ValidationError', async () => {
        const { context } = makeContext()
        const splitSpy = vi.spyOn(field, 'splitColumns')

        await expect(
          resolveValidateAndSplit(field, 'doc', 'create', legacyUploadWrapper(), context),
        ).rejects.toThrow(ValidationError)
        expect(splitSpy).not.toHaveBeenCalled()
      })

      it('clears every column for a null value', async () => {
        const { context } = makeContext()
        const columns = await resolveValidateAndSplit(field, 'doc', 'update', null, context)
        expect(columns).toEqual({ doc_filename: null, doc_filesize: null, doc_url: null })
      })

      it('keeps an already-shaped FileMetadata unchanged (no re-upload) and splits it', async () => {
        const { context, uploadFile } = makeContext()
        const existing: FileMetadata = {
          filename: 'report.pdf',
          originalFilename: 'report.pdf',
          url: 'https://cdn/report.pdf',
          mimeType: 'application/pdf',
          size: 4096,
          uploadedAt: '',
          storageProvider: 'documents',
        }
        const columns = await resolveValidateAndSplit(field, 'doc', 'update', existing, context, {
          doc: existing,
        })
        expect(uploadFile).not.toHaveBeenCalled()
        expect(columns).toEqual({
          doc_filename: 'report.pdf',
          doc_filesize: 4096,
          doc_url: 'https://cdn/report.pdf',
        })
      })

      it('uploads a File-like value and splits the returned metadata', async () => {
        const { context, uploadFile } = makeContext()
        const columns = await resolveValidateAndSplit(field, 'doc', 'create', fakeFile(), context)
        expect(uploadFile).toHaveBeenCalledTimes(1)
        expect(columns).toEqual({
          doc_filename: 'new.pdf',
          doc_filesize: 3,
          doc_url: '/uploads/new.pdf',
        })
      })
    })
  })

  describe('default single-column (JSON) mode — comparison baseline', () => {
    // No `db.columns: 'keystone'` — these fields have no `splitColumns`, so the
    // resolved logical value goes straight to the database as `Json?`. The
    // downstream report's own caveat was that this path was never explicitly
    // verified; these assertions close that gap (it already throws today).
    describe('image()', () => {
      const field = image({ storage: 'images' })

      it('already rejects the legacy upload-wrapper shape (baseline, unaffected by #789)', async () => {
        expect(field.splitColumns).toBeUndefined()
        const { context } = makeContext()
        const resolved = await field.hooks!.resolveInput!({
          listKey: 'Post',
          fieldKey: 'image',
          operation: 'create',
          inputData: { image: legacyUploadWrapper() },
          item: undefined,
          resolvedData: { image: legacyUploadWrapper() },
          context,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)

        expect(() =>
          runValidateFieldRules({ image: resolved }, { image: field }, 'create'),
        ).toThrow(ValidationError)
      })
    })

    describe('file()', () => {
      const field = file({ storage: 'documents' })

      it('already rejects the legacy upload-wrapper shape (baseline, unaffected by #789)', async () => {
        expect(field.splitColumns).toBeUndefined()
        const { context } = makeContext()
        const resolved = await field.hooks!.resolveInput!({
          listKey: 'Post',
          fieldKey: 'doc',
          operation: 'create',
          inputData: { doc: legacyUploadWrapper() },
          item: undefined,
          resolvedData: { doc: legacyUploadWrapper() },
          context,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)

        expect(() => runValidateFieldRules({ doc: resolved }, { doc: field }, 'create')).toThrow(
          ValidationError,
        )
      })
    })
  })
})
