import { config, list } from '@opensaas/stack-core'
import { text, checkbox } from '@opensaas/stack-core/fields'
import { ragPlugin, ollamaEmbeddings, sqliteVssStorage } from '@opensaas/stack-rag'
import { searchable } from '@opensaas/stack-rag/fields'

export default config({
  plugins: [
    ragPlugin({
      provider: ollamaEmbeddings({
        baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
        model: 'nomic-embed-text',
      }),
      storage: sqliteVssStorage({
        distanceFunction: 'cosine',
      }),
    }),
  ],
  db: {
    provider: 'sqlite',
    url: process.env.DATABASE_URL || 'file:./dev.db',
  },
  lists: {
    Document: list({
      fields: {
        title: text({
          validation: { isRequired: true },
        }),
        // Using searchable() wrapper for automatic embedding generation
        // This automatically creates a 'contentEmbedding' field linked to 'content'
        content: searchable(
          text({
            validation: { isRequired: true },
          }),
          {
            provider: 'ollama',
            dimensions: 768,
          },
        ),
        summary: text(),
        published: checkbox({
          defaultValue: false,
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
        // Using searchable() wrapper with custom embedding field name
        body: searchable(
          text({
            validation: { isRequired: true },
          }),
          {
            provider: 'ollama',
            dimensions: 768,
            embeddingFieldName: 'bodyEmbedding', // Optional: customize the embedding field name
          },
        ),
        category: text(),
        published: checkbox({
          defaultValue: false,
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
