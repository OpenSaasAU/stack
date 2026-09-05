import { config, list } from '@opensaas/stack-core'
import {
  checkbox,
  relationship,
  select,
  text,
  timestamp,
  virtual,
} from '@opensaas/stack-core/fields'

/**
 * The project CI regenerates to prove `opensaas generate` is deterministic:
 * a second run must leave `prisma/contract.ts`, `prisma.config.ts` and the two
 * emitted artifacts byte-identical. Its lists cover the constructs whose
 * emission is easiest to make unstable — an enum, a named composite index, a
 * one-to-one, a self-reference, a list-only ref, a second namespace, and a
 * computed field whose `needs` names both a relation and a column.
 */
export default config({
  db: {
    provider: 'postgresql',
    idField: 'uuid7',
    timestamps: true,
    schemas: ['public', 'audit'],
  },
  lists: {
    User: list({
      fields: {
        email: text({ validation: { isRequired: true }, isIndexed: 'unique' }),
        name: text(),
        active: checkbox({ defaultValue: true }),
        posts: relationship({ ref: 'Post.author', many: true }),
        profile: relationship({ ref: 'Profile.user' }),
        manager: relationship({ ref: 'User.reports' }),
        reports: relationship({ ref: 'User.manager', many: true }),
      },
    }),
    Profile: list({
      fields: {
        bio: text(),
        user: relationship({ ref: 'User.profile', db: { foreignKey: true, onDelete: 'cascade' } }),
      },
    }),
    Post: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        status: select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
          defaultValue: 'draft',
          db: { type: 'enum' },
        }),
        publishedAt: timestamp(),
        author: relationship({ ref: 'User.posts', db: { onDelete: 'setNull' } }),
        category: relationship({ ref: 'Category' }),
        byline: virtual({
          type: 'string',
          needs: ['author', 'title'],
          hooks: { resolveOutput: ({ item }) => `${item.title} by ${item.authorId ?? '?'}` },
        }),
      },
      db: {
        map: 'post',
        indexes: [{ fields: ['author', 'status'], name: 'post_author_status' }],
      },
    }),
    Category: list({
      fields: { name: text({ validation: { isRequired: true }, isIndexed: 'unique' }) },
      db: { timestamps: false },
    }),
    AuditEntry: list({
      fields: {
        action: text({ validation: { isRequired: true } }),
        actor: relationship({ ref: 'User' }),
      },
      db: { schema: 'audit' },
    }),
    Settings: list({
      isSingleton: true,
      fields: {
        siteName: text({ defaultValue: 'Fixture' }),
        maintenanceMode: checkbox({ defaultValue: false }),
      },
    }),
  },
})
