import Link from 'next/link'
import { ChatInterface } from '@/components/ChatInterface'

export default function ChatPage() {
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
          <h1 className="text-3xl font-bold text-gray-900 mb-2">AI Chatbot with RAG</h1>
          <p className="text-gray-600">
            Ask questions about OpenSaas Stack. The AI assistant will search the knowledge
            base and provide informed responses with source citations.
          </p>
        </div>

        {/* Chat Interface */}
        <ChatInterface />

        {/* Info */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-2">How it works</h3>
          <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
            <li>Your question is converted into a vector embedding using OpenAI</li>
            <li>
              The top 3 most relevant articles are found using cosine similarity search
            </li>
            <li>
              The articles are provided as context to GPT-4 for generating the response
            </li>
            <li>The response includes citations to the knowledge base articles used</li>
          </ol>
        </div>
      </div>
    </div>
  )
}
