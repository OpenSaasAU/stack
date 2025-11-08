'use client'

import React, { useState, useTransition } from 'react'
import { searchKnowledge, type SearchResult } from '@/app/actions/search'
import { KnowledgeCard } from './KnowledgeCard'

export function SearchInterface() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isPending, startTransition] = useTransition()
  const [hasSearched, setHasSearched] = useState(false)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!query.trim()) return

    startTransition(async () => {
      const searchResults = await searchKnowledge(query)
      setResults(searchResults)
      setHasSearched(true)
    })
  }

  return (
    <div className="max-w-4xl mx-auto">
      <form onSubmit={handleSearch} className="mb-8">
        <div className="flex gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the knowledge base..."
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder:text-gray-400"
            disabled={isPending}
          />
          <button
            type="submit"
            disabled={isPending || !query.trim()}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium transition-colors"
          >
            {isPending ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      {isPending && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">Searching knowledge base...</p>
        </div>
      )}

      {!isPending && hasSearched && (
        <>
          {results.length > 0 ? (
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Found {results.length} result{results.length !== 1 ? 's' : ''}
              </h2>
              <div className="space-y-4">
                {results.map((result) => (
                  <KnowledgeCard
                    key={result.id}
                    title={result.title}
                    content={result.content}
                    category={result.category}
                    score={result.score}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <p className="text-gray-600">No results found for &quot;{query}&quot;</p>
              <p className="text-sm text-gray-500 mt-2">
                Try using different keywords or be more general
              </p>
            </div>
          )}
        </>
      )}

      {!hasSearched && !isPending && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <p className="text-gray-600">
            Enter a query above to search the knowledge base
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Try searching for &quot;access control&quot;, &quot;RAG integration&quot;, or
            &quot;plugin system&quot;
          </p>
        </div>
      )}
    </div>
  )
}
