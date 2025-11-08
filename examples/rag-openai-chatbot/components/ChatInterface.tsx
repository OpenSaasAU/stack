'use client'

import React, { useRef, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'

export function ChatInterface() {
  const { messages, sendMessage, status } = useChat()
  const [input, setInput] = React.useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const isLoading = status === 'submitted' || status === 'streaming'
    if (!input.trim() || isLoading) return

    sendMessage({ text: input })
    setInput('')
  }

  // Check if currently loading
  const isLoading = status === 'submitted' || status === 'streaming'

  // Extract sources from the last assistant message metadata
  const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant')
  const metadata = lastAssistantMessage?.metadata as { sources?: Array<{ id: string; title: string; score: number }> } | undefined
  const sources = metadata?.sources || []

  return (
    <div className="flex flex-col h-[600px] max-w-4xl mx-auto border border-gray-200 rounded-lg overflow-hidden">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Ask me anything about OpenSaas Stack!
            </h3>
            <p className="text-gray-600 text-sm mb-4">
              I have access to a knowledge base with detailed information
            </p>
            <div className="text-left max-w-md mx-auto bg-white rounded-lg p-4 shadow-sm">
              <p className="text-sm font-medium text-gray-700 mb-2">Try asking:</p>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• What is OpenSaas Stack?</li>
                <li>• How does the access control system work?</li>
                <li>• What are hooks in OpenSaas Stack?</li>
                <li>• How do I create custom field types?</li>
              </ul>
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-900 shadow-sm'
              }`}
            >
              {message.parts.map((part, partIndex) => {
                if (part.type === 'text') {
                  return (
                    <p key={partIndex} className="text-sm whitespace-pre-wrap">
                      {part.text}
                    </p>
                  )
                }
                return null
              })}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white rounded-lg px-4 py-2 shadow-sm">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200"></div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Sources */}
      {sources.length > 0 && (
        <div className="border-t border-gray-200 bg-white p-3">
          <p className="text-xs font-medium text-gray-700 mb-2">Sources used:</p>
          <div className="flex flex-wrap gap-2">
            {sources.map((source, index) => (
              <span
                key={source.id}
                className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded"
              >
                [{index + 1}] {source.title} ({Math.round(source.score * 100)}
                %)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-gray-200 bg-white p-4">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder:text-gray-400"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium transition-colors"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  )
}
