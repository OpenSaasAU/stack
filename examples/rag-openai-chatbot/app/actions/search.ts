'use server'

import { getContext } from '@/.opensaas/context'
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'
import { cosineSimilarity } from '@opensaas/stack-rag/storage'

export interface SearchResult {
  id: string
  title: string
  content: string
  category: string
  score: number
}

export async function searchKnowledge(
  query: string,
  options?: { limit?: number; minScore?: number }
): Promise<SearchResult[]> {
  const { limit = 5, minScore = 0.5 } = options || {}

  if (!query || query.trim().length === 0) {
    return []
  }

  try {
    const context = await getContext()

    // Create embedding provider
    const provider = createEmbeddingProvider({
      type: 'openai',
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'text-embedding-3-small',
    })

    // Generate embedding for the query
    const queryVector = await provider.embed(query)

    // Fetch all published knowledge base articles with their embeddings
    const articles = await context.db.knowledgeBase.findMany({
      where: { published: true },
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
        contentEmbedding: true,
      },
    })

    // Calculate similarity scores and filter
    const results = articles
      .map((article) => {
        const embedding = article.contentEmbedding as {
          vector: number[]
          metadata: Record<string, unknown>
        } | null

        if (!embedding?.vector) {
          return null
        }

        const score = cosineSimilarity(queryVector, embedding.vector)

        return {
          id: article.id,
          title: article.title,
          content: article.content,
          category: article.category,
          score,
        }
      })
      .filter((result): result is SearchResult => {
        return result !== null && result.score >= minScore
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return results
  } catch (error) {
    console.error('Search error:', error)
    throw new Error('Failed to perform semantic search')
  }
}
