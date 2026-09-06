import { config, list } from '@opensaas/stack-core'
import { relationship, text } from '@opensaas/stack-core/fields'

/**
 * Two related lists, so the load the Dev database is driven under is the mix
 * ADR-0063's verification set ran: a transaction that writes both sides, and a
 * read that joins them back with `.include()`.
 */
export default config({
  db: { provider: 'postgresql' },
  lists: {
    Author: list({
      fields: {
        name: text({ validation: { isRequired: true } }),
        notes: relationship({ ref: 'Note.author', many: true }),
      },
    }),
    Note: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        author: relationship({ ref: 'Author.notes' }),
      },
    }),
  },
})
