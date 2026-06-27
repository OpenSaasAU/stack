import { describe, it, expect } from 'vitest'
import { generatePrismaExtensions } from './prisma-extensions.js'
import type { OpenSaasConfig, FieldConfig } from '@opensaas/stack-core'
import { text, virtual } from '@opensaas/stack-core/fields'

/**
 * Builds a synthetic multi-column storage field (the shape image()/file()
 * produce in `db: { columns: 'keystone' }` mode). The CLI package does not
 * depend on @opensaas/stack-storage, so we mimic the relevant surface directly:
 * a field with a `resultExtension` (so it participates in the result extension)
 * and a `getColumnNames` that returns the physical part columns. See #559.
 */
function multiColumnStorageField(columns: string[]): FieldConfig {
  return {
    type: 'image',
    resultExtension: {
      outputType: "import('@opensaas/stack-storage').ImageMetadata | null",
    },
    getColumnNames: (fieldName: string) => columns.map((part) => `${fieldName}_${part}`),
  }
}

describe('Prisma Extensions Generator', () => {
  it('derives `needs` from the part columns for keystone-mode image fields', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Production: {
          fields: {
            image: multiColumnStorageField([
              'url',
              'width',
              'height',
              'filesize',
              'contentType',
              'contentDisposition',
              'pathname',
            ]),
          },
        },
      },
    }

    const output = generatePrismaExtensions(config)

    // needs references the physical part columns that actually exist on the
    // model, NOT the logical `image` field (which has no scalar in this mode).
    expect(output).toContain(
      'needs: { image_url: true, image_width: true, image_height: true, image_filesize: true, image_contentType: true, image_contentDisposition: true, image_pathname: true },',
    )
    expect(output).not.toContain('needs: { image: true }')

    // compute must not read a non-existent `image` scalar off the model.
    expect(output).not.toContain('const value = production.image')
  })

  it('derives `needs` from the part columns for keystone-mode file fields', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Production: {
          fields: {
            doc: multiColumnStorageField(['filename', 'filesize', 'url']),
          },
        },
      },
    }

    const output = generatePrismaExtensions(config)

    expect(output).toContain('needs: { doc_filename: true, doc_filesize: true, doc_url: true },')
    expect(output).not.toContain('needs: { doc: true }')
  })

  it('honours custom/overridden column names returned by getColumnNames', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Production: {
          fields: {
            // getColumnNames is the single source of truth for the physical
            // names, so a custom map flows through without hardcoding suffixes.
            banner: {
              type: 'image',
              resultExtension: {
                outputType: "import('@opensaas/stack-storage').ImageMetadata | null",
              },
              getColumnNames: () => ['custom_name', 'banner_pathname'],
            },
          },
        },
      },
    }

    const output = generatePrismaExtensions(config)

    expect(output).toContain('needs: { custom_name: true, banner_pathname: true },')
  })

  it('keeps single-column (non-keystone) fields on the logical field name', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Post: {
          fields: {
            // A single-column field with a resultExtension and no getColumnNames
            // must still emit `needs: { <fieldName>: true }`.
            title: {
              ...text(),
              resultExtension: { outputType: 'string | null' },
            },
          },
        },
      },
    }

    const output = generatePrismaExtensions(config)

    expect(output).toContain('needs: { title: true },')
    expect(output).toContain('const value = post.title')
  })

  it('still emits empty `needs` for virtual fields', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        User: {
          fields: {
            firstName: text(),
            fullName: virtual({
              type: 'string',
              hooks: {
                resolveOutput: ({ item }: { item: Record<string, unknown> }) =>
                  String(item.firstName ?? ''),
              },
            }),
          },
        },
      },
    }

    const output = generatePrismaExtensions(config)

    expect(output).toContain('needs: {},')
  })
})
