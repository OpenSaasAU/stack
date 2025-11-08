import Link from 'next/link'
import { SearchInterface } from '@/components/SearchInterface'

export default function SearchPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/"
            className="text-blue-600 hover:text-blue-700 text-sm font-medium mb-4 inline-block"
          >
            ← Back to Home
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Semantic Search
          </h1>
          <p className="text-gray-600">
            Search the knowledge base using natural language. Results are ranked
            by semantic similarity using vector embeddings.
          </p>
        </div>

        {/* Search Interface */}
        <SearchInterface />

        {/* Info */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-2">
            What is semantic search?
          </h3>
          <p className="text-sm text-blue-800 mb-3">
            Unlike traditional keyword search, semantic search understands the
            meaning behind your query. It uses vector embeddings to find content
            that is conceptually similar, even if it uses different words.
          </p>
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">Example:</p>
            <p>
              Searching for &quot;protecting database operations&quot; will find
              articles about &quot;access control&quot; because they are
              semantically related.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
