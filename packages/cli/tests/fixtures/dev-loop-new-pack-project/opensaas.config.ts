import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'

/**
 * Starts with no declared extension pack, so an edit can add one for the
 * first time in the same breath as a destructive change (#1226) — the
 * sequence `dev-loop-project` can't exercise, since it declares pgvector
 * from the start.
 */
export default config({
  db: {
    provider: 'postgresql',
  },
  lists: {
    Note: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        note: text(),
      },
    }),
  },
})
