import { config, list } from '@opensaas/stack-core'
import { text, select, checkbox } from '@opensaas/stack-core/fields'
import { ragPlugin, openaiEmbeddings, pgvectorStorage } from '@opensaas/stack-rag'
import { searchable } from '@opensaas/stack-rag/fields'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

export default config({
  plugins: [
    ragPlugin({
      provider: openaiEmbeddings({
        apiKey: process.env.OPENAI_API_KEY!,
        model: 'text-embedding-3-small',
      }),
      storage: pgvectorStorage({
        distanceFunction: 'cosine',
      }),
    }),
  ],
  db: {
    provider: 'postgresql',
    url: process.env.DATABASE_URL!,
    prismaClientConstructor: (PrismaClient) => {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
      const adapter = new PrismaPg(pool)
      return new PrismaClient({ adapter })
    },
  },
  lists: {
    KnowledgeBase: list({
      fields: {
        title: text({
          validation: { isRequired: true },
          ui: { displayMode: 'input' },
        }),
        content: searchable(
          text({
            validation: { isRequired: true },
            ui: { displayMode: 'textarea' },
          }),
          {
            provider: 'openai',
            dimensions: 1536,
          }
        ),
        category: select({
          options: [
            { label: 'AI/ML', value: 'ai-ml' },
            { label: 'Web Development', value: 'web-dev' },
            { label: 'Software Engineering', value: 'software-eng' },
            { label: 'Database', value: 'database' },
            { label: 'DevOps', value: 'devops' },
          ],
          validation: { isRequired: true },
          ui: { displayMode: 'select' },
        }),
        published: checkbox({
          defaultValue: true,
        }),
      },
      access: {
        operation: {
          query: () => true,
          // Set to false to demonstrate sudo() bypassing access control
          // The seed script uses sudo() to create articles despite this restriction
          create: () => false,
          update: () => true,
          delete: () => true,
        },
      },
    }),
  },
})
