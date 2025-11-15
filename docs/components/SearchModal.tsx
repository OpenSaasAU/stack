'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, X } from 'lucide-react'
import Link from 'next/link'

interface SearchResult {
  documentId: string
  title?: string
  content: string
  chunkIndex: number
  metadata?: Record<string, unknown>
  score: number
}

interface SearchResponse {
  results: SearchResult[]
  query: string
  count: number
}

export function SearchModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // eslint-disable-next-line no-undef
  const debounceRef = useRef<NodeJS.Timeout>(null)

  // Handle keyboard shortcut (Cmd+K or Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen(true)
      }
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // Perform search
  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([])
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, limit: 10, minScore: 0.6 }),
      })

      if (!response.ok) {
        throw new Error('Search failed')
      }

      const data = (await response.json()) as SearchResponse
      setResults(data.results)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
      setResults([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      performSearch(query)
    }, 300)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [query, performSearch])

  // Handle result click
  const handleResultClick = () => {
    setIsOpen(false)
    setQuery('')
    setResults([])
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 bg-gray-800 rounded-md border border-gray-700 hover:border-gray-600 transition-colors"
      >
        <Search className="w-4 h-4" />
        <span>Search docs...</span>
        <kbd className="ml-auto px-2 py-1 text-xs text-gray-500 bg-gray-900 rounded border border-gray-700">
          ⌘K
        </kbd>
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-gray-900 rounded-lg shadow-2xl border border-gray-800 overflow-hidden">
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
          <Search className="w-5 h-5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search documentation..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-white placeholder-gray-500 outline-none"
          />
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading && (
            <div className="px-4 py-8 text-center text-gray-400">
              <div className="inline-block w-6 h-6 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
            </div>
          )}

          {error && (
            <div className="px-4 py-8 text-center text-red-400">
              <p>{error}</p>
            </div>
          )}

          {!isLoading && !error && results.length === 0 && query.trim() && (
            <div className="px-4 py-8 text-center text-gray-400">
              <p>No results found for &quot;{query}&quot;</p>
            </div>
          )}

          {!isLoading && !error && results.length === 0 && !query.trim() && (
            <div className="px-4 py-8 text-center text-gray-400">
              <p>Start typing to search...</p>
            </div>
          )}

          {!isLoading && results.length > 0 && (
            <div className="py-2">
              {results.map((result, index) => {
                const docPath = `/docs/${result.documentId}`
                return (
                  <Link
                    key={`${result.documentId}-${index}`}
                    href={docPath}
                    onClick={() => handleResultClick()}
                    className="block px-4 py-3 hover:bg-gray-800 transition-colors border-l-2 border-transparent hover:border-blue-500"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium text-white mb-1">
                          {result.title || result.documentId}
                        </h3>
                        <p className="text-sm text-gray-400 line-clamp-2">{result.content}</p>
                      </div>
                      <div className="text-xs text-gray-500 whitespace-nowrap">
                        {Math.round(result.score * 100)}% match
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-500 flex items-center justify-between">
          <span>Semantic search powered by @opensaas/stack-rag</span>
          <div className="flex items-center gap-2">
            <kbd className="px-2 py-1 bg-gray-800 rounded border border-gray-700">↑↓</kbd>
            <span>Navigate</span>
            <kbd className="px-2 py-1 bg-gray-800 rounded border border-gray-700">ESC</kbd>
            <span>Close</span>
          </div>
        </div>
      </div>
    </div>
  )
}
