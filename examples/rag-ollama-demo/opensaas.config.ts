import { config, list } from '@opensaas/stack-core'
import { text, checkbox } from '@opensaas/stack-core/fields'
import { ragPlugin, ollamaEmbeddings, sqliteVssStorage } from '@opensaas/stack-rag'
import { embedding } from '@opensaas/stack-rag/fields'

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
        content: text({
          validation: { isRequired: true },
        }),
        summary: text(),
        contentEmbedding: embedding({
          sourceField: 'content',
          provider: 'ollama',
          dimensions: 768,
          autoGenerate: true,
        }),
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
        body: text({
          validation: { isRequired: true },
        }),
        category: text(),
        bodyEmbedding: embedding({
          sourceField: 'body',
          provider: 'ollama',
          dimensions: 768,
          autoGenerate: true,
        }),
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
