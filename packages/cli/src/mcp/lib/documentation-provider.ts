/**
 * Documentation provider - Fetches documentation from the hosted docs site
 */

import type { DocumentationLookup } from './types.js'

interface SearchResult {
  content: string
  metadata: {
    title?: string
    slug?: string
    section?: string
  }
  score: number
}

interface SearchResponse {
  results: SearchResult[]
  query: string
  count: number
}

export class OpenSaasDocumentationProvider {
  private readonly DOCS_API = 'https://stack.opensaas.au/api/search'
  private cache = new Map<string, { data: DocumentationLookup; timestamp: number }>()
  private readonly CACHE_TTL = 1000 * 60 * 30 // 30 minutes

  // Topic mappings for user-friendly queries
  private topicMappings: Record<string, string> = {
    fields: 'field-types',
    'field types': 'field-types',
    'field type': 'field-types',
    access: 'access-control',
    'access control': 'access-control',
    permissions: 'access-control',
    auth: 'authentication',
    authentication: 'authentication',
    login: 'authentication',
    'sign in': 'authentication',
    hooks: 'hooks',
    hook: 'hooks',
    lifecycle: 'hooks',
    plugins: 'plugin-system',
    plugin: 'plugin-system',
    rag: 'rag',
    search: 'semantic-search',
    'semantic search': 'semantic-search',
    storage: 'file-storage',
    files: 'file-storage',
    upload: 'file-storage',
    config: 'configuration',
    configuration: 'configuration',
    prisma: 'prisma-integration',
    database: 'database-setup',
    deployment: 'deployment',
    deploy: 'deployment',
  }

  /**
   * Search documentation by query
   */
  async searchDocs(query: string, limit = 5, minScore = 0.7): Promise<DocumentationLookup> {
    const cacheKey = `search:${query}:${limit}:${minScore}`

    // Check cache
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data
    }

    try {
      const response = await fetch(this.DOCS_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, limit, minScore }),
      })

      if (!response.ok) {
        throw new Error(`Docs API error: ${response.statusText}`)
      }

      const data = (await response.json()) as SearchResponse

      const docLookup: DocumentationLookup = {
        topic: query,
        content: this.formatSearchResults(data.results),
        url: 'https://stack.opensaas.au/',
        codeExamples: this.extractCodeExamples(data.results),
        relatedTopics: this.extractRelatedTopics(data.results),
      }

      // Cache the result
      this.cache.set(cacheKey, { data: docLookup, timestamp: Date.now() })

      return docLookup
    } catch (error) {
      console.error('Error fetching documentation:', error)
      return this.getFallbackDocs(query)
    }
  }

  /**
   * Get documentation for a specific topic
   */
  async getTopicDocs(topic: string): Promise<DocumentationLookup> {
    // Normalize topic using mappings
    const normalizedTopic = this.topicMappings[topic.toLowerCase()] || topic

    return this.searchDocs(normalizedTopic, 3, 0.8)
  }

  /**
   * Format search results into readable content
   */
  private formatSearchResults(results: SearchResult[]): string {
    if (results.length === 0) {
      return 'No documentation found for this query.'
    }

    return results
      .map((result, index) => {
        const title = result.metadata.title || `Section ${index + 1}`
        const section = result.metadata.section || ''
        const score = (result.score * 100).toFixed(0)

        return `### ${title}${section ? ` (${section})` : ''} [Relevance: ${score}%]\n\n${result.content}\n`
      })
      .join('\n---\n\n')
  }

  /**
   * Extract code examples from search results
   */
  private extractCodeExamples(results: SearchResult[]): string[] {
    const codeExamples: string[] = []
    const codeBlockRegex = /```[\s\S]*?```/g

    for (const result of results) {
      const matches = result.content.match(codeBlockRegex)
      if (matches) {
        codeExamples.push(...matches)
      }
    }

    return codeExamples
  }

  /**
   * Extract related topics from search results
   */
  private extractRelatedTopics(results: SearchResult[]): string[] {
    const topics = new Set<string>()

    for (const result of results) {
      if (result.metadata.section) {
        topics.add(result.metadata.section)
      }
    }

    return Array.from(topics)
  }

  /**
   * Fallback documentation when API is unavailable
   */
  private getFallbackDocs(query: string): DocumentationLookup {
    return {
      topic: query,
      content: `Unable to fetch documentation from the docs site at this time.

Please visit the OpenSaaS Stack documentation directly:
https://stack.opensaas.au/

For ${query}, you can also check:
- GitHub repository: https://github.com/OpenSaasAU/stack
- Example projects in the examples/ directory`,
      url: 'https://stack.opensaas.au/',
      codeExamples: [],
      relatedTopics: [],
    }
  }

  /**
   * Clear expired cache entries
   */
  clearExpiredCache(): void {
    const now = Date.now()
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp >= this.CACHE_TTL) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    this.cache.clear()
  }
}
