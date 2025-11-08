'use server'

import OpenAI from 'openai'
import { searchKnowledge } from './search'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatResponse {
  message: string
  sources: Array<{ id: string; title: string; score: number }>
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

export async function chatWithKnowledge(
  messages: ChatMessage[],
  userMessage: string
): Promise<ChatResponse> {
  try {
    // Search for relevant knowledge
    const searchResults = await searchKnowledge(userMessage, {
      limit: 3,
      minScore: 0.6,
    })

    // Build context from search results
    let context = ''
    if (searchResults.length > 0) {
      context = 'Relevant information from the knowledge base:\n\n'
      searchResults.forEach((result, index) => {
        context += `[${index + 1}] ${result.title}\n${result.content}\n\n`
      })
    }

    // Build conversation history
    const conversationMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `You are a helpful AI assistant with access to a knowledge base. When answering questions, use the provided context from the knowledge base when relevant. If the context contains relevant information, cite the sources by their number [1], [2], etc. If the context doesn't contain relevant information, you can use your general knowledge but mention that you're not using the knowledge base. Be concise and accurate.`,
      },
    ]

    // Add conversation history (last 5 messages)
    const recentMessages = messages.slice(-5)
    conversationMessages.push(
      ...recentMessages.map(
        (msg): OpenAI.Chat.ChatCompletionMessageParam => ({
          role: msg.role,
          content: msg.content,
        })
      )
    )

    // Add current user message with context
    const userMessageWithContext = context
      ? `${context}\nUser question: ${userMessage}`
      : userMessage

    conversationMessages.push({
      role: 'user',
      content: userMessageWithContext,
    })

    // Get completion from OpenAI
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
      messages: conversationMessages,
      temperature: 0.7,
      max_tokens: 500,
    })

    const assistantMessage =
      completion.choices[0]?.message?.content || 'Sorry, I could not generate a response.'

    return {
      message: assistantMessage,
      sources: searchResults.map((result) => ({
        id: result.id,
        title: result.title,
        score: result.score,
      })),
    }
  } catch (error) {
    console.error('Chat error:', error)
    throw new Error('Failed to generate chat response')
  }
}
