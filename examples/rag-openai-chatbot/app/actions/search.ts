'use server'

import { getContext } from '@/.opensaas/context'
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'

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
  // `contentEmbedding` is a cosine column, so a score is the raw cosine on
  // [-1, 1] rather than a normalised 0-1: 0.2 is a loose floor, not a strict one.
  const { limit = 5, minScore = 0.2 } = options || {}

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

    // One scoped query: the access filter, the minScore bound and the ranking
    // all live inside `nearest()` (ADR-0045). No `published` filter here — this
    // context is anonymous, and the list's own `query` rule bounds it to
    // published rows before the ranking runs.
    const matches = await context.db.KnowledgeBase.nearest(
      'contentEmbedding',
      queryVector,
      {
        limit,
        minScore,
      }
    )

    return matches.map((match) => ({
      id: match.item.id,
      title: match.item.title,
      content: match.item.content,
      category: match.item.category,
      score: match.score,
    }))
  } catch (error) {
    console.error('Search error:', error)
    throw new Error('Failed to perform semantic search')
  }
}
