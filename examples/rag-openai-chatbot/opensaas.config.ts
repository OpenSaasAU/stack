import { config, list } from '@opensaas/stack-core'
import { text, select, checkbox } from '@opensaas/stack-core/fields'
import { ragPlugin, openaiEmbeddings } from '@opensaas/stack-rag'
import { embedding } from '@opensaas/stack-rag/fields'
import type { AccessControl } from '@opensaas/stack-core'

// The chatbot and the search page both read anonymously, so this filter is what
// keeps an unpublished article out of an answer. `nearest()` ranks inside the
// scoped set rather than filtering a ranked one, so the bound holds even when
// the unpublished row is the closest match.
const publishedOrSignedIn: AccessControl = ({ session }) => {
  if (session) return true
  return { published: { equals: true } }
}

export default config({
  plugins: [
    ragPlugin({
      provider: openaiEmbeddings({
        apiKey: process.env.OPENAI_API_KEY!,
        model: 'text-embedding-3-small',
        // Unset reaches OpenAI. Point it at Azure OpenAI or any endpoint that
        // speaks the same embeddings API to use that instead — the model's
        // dimension still has to match the column's 1536.
        ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
      }),
    }),
  ],
  db: {
    provider: 'postgresql',
  },
  lists: {
    KnowledgeBase: list({
      fields: {
        title: text({
          validation: { isRequired: true },
          ui: { displayMode: 'input' },
        }),
        content: text({
          validation: { isRequired: true },
          ui: { displayMode: 'textarea' },
        }),
        // The manual pattern, where rag-ollama-demo shows the `searchable()`
        // wrapper. Spelling the companion field out is what lets the column
        // declare its own distance function and index.
        contentEmbedding: embedding({
          sourceField: 'content',
          provider: 'openai',
          dimensions: 1536,
          distanceFunction: 'cosine',
          autoGenerate: true,
          // Known limit: @prisma/orm-extension-pgvector@8.0.0-rc.8 registers no
          // index types, so this derives the column type and the operator class
          // and is not yet lowered to a CREATE INDEX (#1265). Every search here
          // is an exact scan until the pack reaches GA.
          index: { method: 'hnsw', m: 16, efConstruction: 64 },
        }),
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
          query: publishedOrSignedIn,
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
