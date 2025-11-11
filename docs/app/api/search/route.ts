import { NextRequest, NextResponse } from 'next/server'
import { createJsonFileStorage } from '@opensaas/stack-rag/storage'
import { createProviderFromEnv } from '@opensaas/stack-rag/runtime'
import { resolve } from 'node:path'

// Configuration
const EMBEDDINGS_PATH = resolve(process.cwd(), '.embeddings/docs.json')

// Create provider once (reused across requests)
const provider = createProviderFromEnv()

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { query: string; limit?: number; minScore?: number }
    const { query, limit = 10, minScore = 0.6 } = body

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Invalid query parameter' }, { status: 400 })
    }

    // Generate embedding for the query using stack utilities
    const queryEmbedding = await provider.embed(query)

    // Load storage and perform search
    const storage = createJsonFileStorage(EMBEDDINGS_PATH)

    const results = await storage.search<{
      documentId: string
      title?: string
      content: string
      chunkIndex: number
      metadata?: Record<string, unknown>
      score: number
    }>('', '', queryEmbedding, {
      limit,
      minScore,
      titleBoost: 1, // 1.5x boost for title matches (moderate advantage without score saturation)
      // @ts-expect-error - Context not used in file storage
      context: null as unknown as { db: Record<string, unknown>; session: unknown }, // Not used for file storage
    })

    // Format and deduplicate results by document ID
    // Track best score for ranking, but prefer content chunks for display
    const seenDocuments = new Map<
      string,
      {
        documentId: string
        title?: string
        content: string
        chunkIndex: number
        metadata?: Record<string, unknown>
        score: number
        bestScore: number
      }
    >()

    for (const result of results) {
      const documentId = result.item.documentId
      if (!documentId) continue

      const existing = seenDocuments.get(documentId)
      const isTitle = result.item.metadata?.isTitle === true

      if (!existing) {
        // First chunk for this document
        seenDocuments.set(documentId, {
          documentId,
          title: result.item.title,
          content: result.item.content,
          chunkIndex: result.item.chunkIndex,
          metadata: result.item.metadata,
          score: result.score,
          bestScore: result.score,
        })
      } else {
        // Update bestScore if this chunk scores higher
        const newBestScore = Math.max(existing.bestScore, result.score)

        // Prefer content chunks over title chunks for display
        // Replace if: (1) existing is title and new is content, OR (2) both are content and new scores higher
        const existingIsTitle = existing.metadata?.isTitle === true
        const shouldReplace =
          (existingIsTitle && !isTitle) ||
          (!existingIsTitle && !isTitle && result.score > existing.score)

        if (shouldReplace) {
          seenDocuments.set(documentId, {
            documentId,
            title: result.item.title,
            content: result.item.content,
            chunkIndex: result.item.chunkIndex,
            metadata: result.item.metadata,
            score: result.score,
            bestScore: newBestScore,
          })
        } else {
          // Keep existing display chunk but update bestScore
          existing.bestScore = newBestScore
        }
      }
    }

    // Convert to array, sort by bestScore, and cap scores at 100%
    const formattedResults = Array.from(seenDocuments.values())
      .sort((a, b) => b.bestScore - a.bestScore)
      .map((result) => ({
        documentId: result.documentId,
        title: result.title,
        content: result.content,
        chunkIndex: result.chunkIndex,
        metadata: result.metadata,
        score: Math.min(result.bestScore, 1.0), // Cap at 100%
      }))

    return NextResponse.json({
      results: formattedResults,
      query,
      count: formattedResults.length,
      totalChunks: results.length, // Show how many chunks matched before deduplication
    })
  } catch (error) {
    console.error('Search API error:', error)

    return NextResponse.json(
      {
        error: 'Search failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'POST to this endpoint with { query: string } to search documentation',
    provider: provider.type,
    model: provider.model,
    dimensions: provider.dimensions,
  })
}
