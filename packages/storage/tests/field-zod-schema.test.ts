import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import type { ContractColumnDescriptor, ContractFieldDescriptor } from '@opensaas/stack-core/extend'
import { image, file } from '../src/fields/index.js'
import type { ImageMetadata, FileMetadata } from '../src/config/types.js'

/**
 * Regression tests for issue #618: file()/image() fields were erroneously
 * required on create/update because getZodSchema() returned
 * `z.union([metadataSchema, z.null(), z.undefined()])`. In Zod 4, a union that
 * merely accepts an `undefined` *value* does NOT make the object KEY optional —
 * an omitted key fails with "expected nonoptional, received undefined". The fix
 * returns `metadataSchema.nullish()` so the key is genuinely optional.
 *
 * Core composes create/update input via `z.object({ <field>: getZodSchema(...) })`
 * with no extra wrapping (see packages/core/src/validation/schema.ts), so these
 * tests reproduce that composition exactly.
 */

/** A correctly-shaped ImageMetadata value. */
const validImageMetadata: ImageMetadata = {
  filename: 'photo.png',
  originalFilename: 'photo.png',
  url: '/uploads/photo.png',
  mimeType: 'image/png',
  size: 1234,
  width: 100,
  height: 100,
  uploadedAt: new Date().toISOString(),
  storageProvider: 'images',
}

/** A correctly-shaped FileMetadata value. */
const validFileMetadata: FileMetadata = {
  filename: 'doc.pdf',
  originalFilename: 'doc.pdf',
  url: '/uploads/doc.pdf',
  mimeType: 'application/pdf',
  size: 4096,
  uploadedAt: new Date().toISOString(),
  storageProvider: 'documents',
}

/** Wrap a single field schema the way core's generateZodSchema does. */
function objectFor(
  field: { getZodSchema?: (name: string, op: 'create' | 'update') => z.ZodTypeAny },
  fieldName: string,
  operation: 'create' | 'update',
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const schema = field.getZodSchema?.(fieldName, operation)
  if (!schema) throw new Error('field has no getZodSchema')
  return z.object({ [fieldName]: schema })
}

describe('image()/file() getZodSchema key-optionality (issue #618)', () => {
  for (const operation of ['create', 'update'] as const) {
    describe(`${operation}`, () => {
      it(`image(): an OMITTED field validates (no key present)`, () => {
        const obj = objectFor(image({ storage: 'images' }), 'avatar', operation)
        const result = obj.safeParse({})
        expect(result.success).toBe(true)
        if (result.success) {
          // Omitted optional key reads back as undefined.
          expect(result.data.avatar).toBeUndefined()
        }
      })

      it(`file(): an OMITTED field validates (no key present)`, () => {
        const obj = objectFor(file({ storage: 'documents' }), 'resume', operation)
        const result = obj.safeParse({})
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.resume).toBeUndefined()
        }
      })

      it(`image(): explicit null validates`, () => {
        const obj = objectFor(image({ storage: 'images' }), 'avatar', operation)
        expect(obj.safeParse({ avatar: null }).success).toBe(true)
      })

      it(`file(): explicit null validates`, () => {
        const obj = objectFor(file({ storage: 'documents' }), 'resume', operation)
        expect(obj.safeParse({ resume: null }).success).toBe(true)
      })

      it(`image(): explicit undefined validates`, () => {
        const obj = objectFor(image({ storage: 'images' }), 'avatar', operation)
        expect(obj.safeParse({ avatar: undefined }).success).toBe(true)
      })

      it(`file(): explicit undefined validates`, () => {
        const obj = objectFor(file({ storage: 'documents' }), 'resume', operation)
        expect(obj.safeParse({ resume: undefined }).success).toBe(true)
      })

      it(`image(): null/omitted validates in multi-column (keystone) mode`, () => {
        const field = image({ storage: 'images', db: { columns: 'keystone' } })
        const obj = objectFor(field, 'avatar', operation)
        expect(obj.safeParse({}).success).toBe(true)
        expect(obj.safeParse({ avatar: null }).success).toBe(true)
      })

      it(`file(): null/omitted validates in multi-column (keystone) mode`, () => {
        const field = file({ storage: 'documents', db: { columns: 'keystone' } })
        const obj = objectFor(field, 'resume', operation)
        expect(obj.safeParse({}).success).toBe(true)
        expect(obj.safeParse({ resume: null }).success).toBe(true)
      })

      it(`image(): a correctly-shaped metadata object validates`, () => {
        const obj = objectFor(image({ storage: 'images' }), 'avatar', operation)
        expect(obj.safeParse({ avatar: validImageMetadata }).success).toBe(true)
      })

      it(`file(): a correctly-shaped metadata object validates`, () => {
        const obj = objectFor(file({ storage: 'documents' }), 'resume', operation)
        expect(obj.safeParse({ resume: validFileMetadata }).success).toBe(true)
      })

      it(`image(): a malformed metadata object still fails`, () => {
        const obj = objectFor(image({ storage: 'images' }), 'avatar', operation)
        // Missing required sub-fields (width/height/size/...).
        expect(obj.safeParse({ avatar: { filename: 'x.png' } }).success).toBe(false)
      })

      it(`file(): a malformed metadata object still fails`, () => {
        const obj = objectFor(file({ storage: 'documents' }), 'resume', operation)
        // size should be a number, not a string.
        expect(obj.safeParse({ resume: { ...validFileMetadata, size: 'big' } }).success).toBe(false)
      })
    })
  }
})

/**
 * `db.isNullable: false` emits a NOT NULL column. The declared TypeScript face
 * and the Zod schema must follow it, or `{ field: null }` type-checks and
 * validates its way to a database not-null violation.
 */
describe('image()/file() nullability is one decision', () => {
  const CONFIG: OpenSaasConfig = { db: { provider: 'postgresql' }, lists: {} }

  function columnOf(
    field: {
      getContractField?: (
        name: string,
        list: string,
        config: OpenSaasConfig,
      ) => ContractFieldDescriptor
    },
    fieldName: string,
  ): ContractColumnDescriptor {
    const descriptor = field.getContractField?.(fieldName, 'Post', CONFIG)
    if (!descriptor || descriptor.kind !== 'column') {
      throw new Error('expected a single-column descriptor')
    }
    return descriptor
  }

  describe('a NON-nullable field', () => {
    const avatar = image({ storage: 'images', db: { isNullable: false } })
    const resume = file({ storage: 'documents', db: { isNullable: false } })

    it('emits a NOT NULL column', () => {
      expect(columnOf(avatar, 'avatar').nullable).toBe(false)
      expect(columnOf(resume, 'resume').nullable).toBe(false)
    })

    it('declares a face without `| null`', () => {
      expect(avatar.outputType).toBe("import('@opensaas/stack-storage').ImageMetadata")
      expect(avatar.inputType).toBe("File | import('@opensaas/stack-storage').ImageMetadata")
      expect(resume.outputType).toBe("import('@opensaas/stack-storage').FileMetadata")
      expect(resume.inputType).toBe("File | import('@opensaas/stack-storage').FileMetadata")
      expect(avatar.resultExtension?.outputType).toBe(avatar.outputType)
      expect(resume.resultExtension?.outputType).toBe(resume.outputType)
    })

    for (const operation of ['create', 'update'] as const) {
      it(`REJECTS null on ${operation}`, () => {
        expect(objectFor(avatar, 'avatar', operation).safeParse({ avatar: null }).success).toBe(
          false,
        )
        expect(objectFor(resume, 'resume', operation).safeParse({ resume: null }).success).toBe(
          false,
        )
      })

      it(`still accepts a correctly-shaped metadata object on ${operation}`, () => {
        expect(
          objectFor(avatar, 'avatar', operation).safeParse({ avatar: validImageMetadata }).success,
        ).toBe(true)
        expect(
          objectFor(resume, 'resume', operation).safeParse({ resume: validFileMetadata }).success,
        ).toBe(true)
      })
    }

    it('requires the key on create — the column has no default to fall back on', () => {
      expect(objectFor(avatar, 'avatar', 'create').safeParse({}).success).toBe(false)
      expect(objectFor(resume, 'resume', 'create').safeParse({}).success).toBe(false)
    })

    it('allows the key to be omitted on update, so partial updates still work', () => {
      expect(objectFor(avatar, 'avatar', 'update').safeParse({}).success).toBe(true)
      expect(objectFor(resume, 'resume', 'update').safeParse({}).success).toBe(true)
    })
  })

  describe('a nullable field (the default, and an explicit `isNullable: true`)', () => {
    for (const [label, avatar, resume] of [
      ['default', image({ storage: 'images' }), file({ storage: 'documents' })],
      [
        'explicit',
        image({ storage: 'images', db: { isNullable: true } }),
        file({ storage: 'documents', db: { isNullable: true } }),
      ],
    ] as const) {
      it(`${label}: emits a nullable column, a \`| null\` face, and accepts null`, () => {
        expect(columnOf(avatar, 'avatar').nullable).toBe(true)
        expect(avatar.outputType).toBe("import('@opensaas/stack-storage').ImageMetadata | null")
        expect(resume.inputType).toBe(
          "File | import('@opensaas/stack-storage').FileMetadata | null",
        )
        for (const operation of ['create', 'update'] as const) {
          expect(objectFor(avatar, 'avatar', operation).safeParse({ avatar: null }).success).toBe(
            true,
          )
          expect(objectFor(resume, 'resume', operation).safeParse({ resume: null }).success).toBe(
            true,
          )
        }
      })
    }
  })

  // Multi-column mode has no single column for `isNullable` to constrain: every
  // part column is nullable and an all-NULL row assembles to null.
  it('multi-column mode stays nullable even when `isNullable: false` is set', () => {
    const avatar = image({
      storage: 'images',
      db: { isNullable: false, columns: 'keystone' },
    })
    const resume = file({
      storage: 'documents',
      db: { isNullable: false, columns: 'keystone' },
    })

    expect(avatar.outputType).toBe("import('@opensaas/stack-storage').ImageMetadata | null")
    expect(resume.outputType).toBe("import('@opensaas/stack-storage').FileMetadata | null")
    for (const operation of ['create', 'update'] as const) {
      expect(objectFor(avatar, 'avatar', operation).safeParse({ avatar: null }).success).toBe(true)
      expect(objectFor(resume, 'resume', operation).safeParse({ resume: null }).success).toBe(true)
    }
  })
})
