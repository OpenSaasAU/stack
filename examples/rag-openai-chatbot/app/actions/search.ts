'use server'

import { getContext } from '@/.opensaas/context'
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'
import { createVectorStorage } from '@opensaas/stack-rag/storage'
import config from '@/opensaas.config'

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

    // Use pgvector storage for scalable semantic search with access control
    const storage = createVectorStorage({
      type: 'pgvector',
      distanceFunction: 'cosine',
    })

    // Search using database-level vector similarity
    // This is much more scalable than fetching all items and calculating in JS
    const results = await storage.search<{
      id: string
      title: string
      content: string
      category: string
    }>('KnowledgeBase', 'contentEmbedding', queryVector, {
      limit,
      minScore,
      context,
      where: { published: true },
      config: await config, // Pass config for access control enforcement
    })

    // Map to simplified result format
    return results.map((r) => ({
      id: r.item.id,
      title: r.item.title,
      content: r.item.content,
      category: r.item.category,
      score: r.score,
    }))
  } catch (error) {
    console.error('Search error:', error)
    throw new Error('Failed to perform semantic search')
  }
}
