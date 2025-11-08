import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <div className="max-w-5xl mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">OpenSaas RAG Chatbot</h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            An intelligent chatbot powered by OpenAI, vector embeddings, and pgvector for
            semantic search
          </p>
        </div>

        {/* Feature Cards */}
        <div className="grid md:grid-cols-3 gap-8 mb-16">
          <div className="bg-white rounded-lg shadow-md p-6 border border-gray-100">
            <div className="text-3xl mb-4">🤖</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">AI-Powered Chat</h3>
            <p className="text-gray-600 text-sm">
              Chat with an AI assistant that has access to a comprehensive knowledge base
              about OpenSaas Stack
            </p>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6 border border-gray-100">
            <div className="text-3xl mb-4">🔍</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Semantic Search</h3>
            <p className="text-gray-600 text-sm">
              Search the knowledge base using natural language with vector embeddings and
              similarity scoring
            </p>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6 border border-gray-100">
            <div className="text-3xl mb-4">📚</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Knowledge Base</h3>
            <p className="text-gray-600 text-sm">
              Manage articles with automatic embedding generation using OpenAI and
              pgvector storage
            </p>
          </div>
        </div>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
          <Link
            href="/chat"
            className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-center transition-colors"
          >
            Try the Chatbot
          </Link>
          <Link
            href="/search"
            className="px-8 py-3 bg-white text-blue-600 border-2 border-blue-600 rounded-lg hover:bg-blue-50 font-medium text-center transition-colors"
          >
            Semantic Search
          </Link>
          <Link
            href="/admin"
            className="px-8 py-3 bg-gray-800 text-white rounded-lg hover:bg-gray-900 font-medium text-center transition-colors"
          >
            Admin Panel
          </Link>
        </div>

        {/* Tech Stack */}
        <div className="bg-white rounded-lg shadow-md p-8 border border-gray-100">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6 text-center">
            Built With
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            <div>
              <p className="font-semibold text-gray-900">OpenSaas Stack</p>
              <p className="text-sm text-gray-600">Config-first framework</p>
            </div>
            <div>
              <p className="font-semibold text-gray-900">OpenAI</p>
              <p className="text-sm text-gray-600">Embeddings & Chat</p>
            </div>
            <div>
              <p className="font-semibold text-gray-900">pgvector</p>
              <p className="text-sm text-gray-600">Vector storage</p>
            </div>
            <div>
              <p className="font-semibold text-gray-900">Next.js</p>
              <p className="text-sm text-gray-600">App Router</p>
            </div>
          </div>
        </div>

        {/* Features List */}
        <div className="mt-16">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6 text-center">
            Features
          </h2>
          <div className="bg-white rounded-lg shadow-md p-8 border border-gray-100">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="flex items-start">
                <span className="text-green-500 mr-3">✓</span>
                <span className="text-gray-700">
                  Automatic embedding generation with OpenAI
                </span>
              </div>
              <div className="flex items-start">
                <span className="text-green-500 mr-3">✓</span>
                <span className="text-gray-700">
                  RAG-enhanced chat responses with source citations
                </span>
              </div>
              <div className="flex items-start">
                <span className="text-green-500 mr-3">✓</span>
                <span className="text-gray-700">
                  Semantic search with similarity scores
                </span>
              </div>
              <div className="flex items-start">
                <span className="text-green-500 mr-3">✓</span>
                <span className="text-gray-700">Full CRUD admin interface</span>
              </div>
              <div className="flex items-start">
                <span className="text-green-500 mr-3">✓</span>
                <span className="text-gray-700">
                  PostgreSQL with pgvector for production-ready vector storage
                </span>
              </div>
              <div className="flex items-start">
                <span className="text-green-500 mr-3">✓</span>
                <span className="text-gray-700">
                  18 pre-loaded articles about OpenSaas Stack
                </span>
              </div>
              <div className="flex items-start">
                <span className="text-green-500 mr-3">✓</span>
                <span className="text-gray-700">
                  Type-safe with TypeScript and Zod validation
                </span>
              </div>
              <div className="flex items-start">
                <span className="text-green-500 mr-3">✓</span>
                <span className="text-gray-700">
                  No authentication required (simplified demo)
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
