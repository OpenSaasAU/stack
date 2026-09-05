import { config, list } from '@opensaas/stack-core'
import { checkbox, relationship, select, text, timestamp } from '@opensaas/stack-core/fields'

/**
 * The project CI regenerates to prove `opensaas generate` is deterministic:
 * a second run must leave `prisma/contract.ts`, `prisma.config.ts` and the two
 * emitted artifacts byte-identical. Its lists cover the constructs whose
 * emission is easiest to make unstable — an enum, a named composite index, a
 * one-to-one, a self-reference, a list-only ref and a second namespace. Its
 * declared pgvector pack puts the seeded extension contract space under
 * `migrations/` inside the same gate (ADR-0065).
 */
export default config({
  db: {
    provider: 'postgresql',
    idField: 'uuid7',
    timestamps: true,
    schemas: ['public', 'audit'],
    extensions: [{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }],
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
