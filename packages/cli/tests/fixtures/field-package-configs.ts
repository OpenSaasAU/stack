import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { file, image } from '@opensaas/stack-storage/fields'
import { richText } from '@opensaas/stack-tiptap/fields'

/**
 * The third-party field packages on the contract-shaped builder surface
 * (spec 8 / #1167). Core cannot hold this fixture: `@opensaas/stack-storage`
 * and `@opensaas/stack-tiptap` both depend on core, so importing them there
 * would close a workspace cycle.
 *
 * `Article` uses each field in its default single-column backing; `Legacy`
 * puts both storage fields in Keystone-parity multi-column mode, where one
 * logical field emits several physical columns.
 */
export const fieldPackageConfig: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    Article: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        body: richText({ validation: { isRequired: true } }),
        teaser: richText(),
        hero: image({ storage: 'images' }),
        attachment: file({ storage: 'documents' }),
      },
    },
    Legacy: {
      fields: {
        title: text(),
        hero: image({ storage: 'images', db: { columns: 'keystone' } }),
        attachment: file({ storage: 'documents', db: { columns: 'keystone' } }),
        brochure: file({
          storage: 'documents',
          db: { columns: { mode: 'keystone', map: { url: 'brochure_href' } } },
        }),
      },
    },
  },
}
