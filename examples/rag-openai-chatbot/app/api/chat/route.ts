import { openai } from '@ai-sdk/openai'
import { streamText, type UIMessage, convertToModelMessages } from 'ai'
import { searchKnowledge } from '@/app/actions/search'

// Allow streaming responses up to 30 seconds
export const maxDuration = 30

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  // Get the last user message for RAG search
  const lastMessage = messages[messages.length - 1]
  let userQuery = ''

  if (lastMessage && lastMessage.role === 'user') {
    // Extract text from the user's message parts
    const textPart = lastMessage.parts?.find((part) => part.type === 'text')
    userQuery = textPart?.text || ''
  }

  // Perform semantic search to find relevant knowledge base articles
  let searchResults: Awaited<ReturnType<typeof searchKnowledge>> = []
  if (userQuery.trim()) {
    try {
      searchResults = await searchKnowledge(userQuery, {
        limit: 3,
        minScore: 0.6,
      })
    } catch (error) {
      console.error('Semantic search error:', error)
      // Continue without search results if search fails
    }
  }

  // Build system message with RAG context
  let systemMessage =
    'You are a helpful AI assistant with access to a knowledge base about OpenSaas Stack. When answering questions, use the provided context from the knowledge base when relevant. If the context contains relevant information, cite the sources by their number [1], [2], etc. If the context does not contain relevant information, you can use your general knowledge but mention that you are not using the knowledge base. Be concise and accurate.'

  if (searchResults.length > 0) {
    systemMessage += '\n\nRelevant information from the knowledge base:\n\n'
    searchResults.forEach((result, index) => {
      systemMessage += `[${index + 1}] ${result.title}\n${result.content}\n\n`
    })
  }

  // Stream the response using Vercel AI SDK
  const result = streamText({
    model: openai(process.env.OPENAI_CHAT_MODEL || 'gpt-5-nano'),
    system: systemMessage,
    messages: convertToModelMessages(messages),
  })

  // Return streaming response with sources as metadata
  return result.toUIMessageStreamResponse({
    messageMetadata: () => ({
      sources: searchResults.map((result) => ({
        id: result.id,
        title: result.title,
        score: result.score,
      })),
    }),
  })
}
