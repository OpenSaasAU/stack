import { config, list } from '@opensaas/stack-core'
import { text, json } from '@opensaas/stack-core/fields'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

export default config({
  db: {
    provider: 'sqlite',
    url: process.env.DATABASE_URL || 'file:./dev.db',
    prismaClientConstructor: (PrismaClient) => {
      const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || './dev.db' })
      return new PrismaClient({ adapter })
    },
  },
  lists: {
    Product: list({
      fields: {
        // Basic fields
        name: text({
          validation: { isRequired: true },
        }),

        // Default JSON field (uses textarea)
        metadata: json({
          validation: { isRequired: false },
          ui: {
            placeholder: 'Enter product metadata as JSON...',
            rows: 8,
            formatted: true,
          },
        }),

        // Custom JSON field (uses fieldType to reference registered JsonEditor)
        settings: json({
          validation: { isRequired: false },
          ui: {
            fieldType: 'jsonEditor',
            placeholder: 'Enter product settings as JSON...',
            rows: 12,
          },
        }),

        // Required JSON field
        configuration: json({
          validation: { isRequired: true },
          ui: {
            fieldType: 'jsonEditor',
            placeholder: 'Enter product configuration (required)...',
          },
        }),
      },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
    }),

    Article: list({
      fields: {
        title: text({
          validation: { isRequired: true },
        }),

        // JSON field for rich content structure
        content: json({
          validation: { isRequired: false },
          ui: {
            fieldType: 'jsonEditor',
            placeholder: 'Enter article content structure...',
            rows: 15,
          },
        }),

        // JSON field for tags/categories with custom UI
        taxonomy: json({
          validation: { isRequired: false },
          ui: {
            fieldType: 'taxonomy',
          },
        }),
      },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
    }),
  },
})
