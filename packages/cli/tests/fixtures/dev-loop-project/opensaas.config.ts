import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'

/**
 * The smallest project the dev loop can be run against end to end: one list to
 * reconcile and one declared extension pack, so `opensaas dev` has both a
 * table to create and a `CREATE EXTENSION` to run against the Dev database's
 * PGlite.
 */
export default config({
  db: {
    provider: 'postgresql',
    extensions: [{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }],
  },
  lists: {
    Note: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
      },
    }),
  },
})
