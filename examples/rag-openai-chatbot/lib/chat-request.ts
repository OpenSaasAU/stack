import { z } from 'zod'
import type { UIMessage } from 'ai'

export const MAX_MESSAGES = 20
export const MAX_PARTS_PER_MESSAGE = 10
export const MAX_TEXT_LENGTH = 2000

const textPart = z.object({
  type: z.literal('text'),
  text: z.string().max(MAX_TEXT_LENGTH),
})

const chatMessage = z.object({
  id: z.string().max(200).optional(),
  role: z.enum(['user', 'assistant']),
  parts: z.array(textPart).min(1).max(MAX_PARTS_PER_MESSAGE),
})

const chatBody = z.object({
  messages: z.array(chatMessage).min(1).max(MAX_MESSAGES),
})

export function parseChatBody(body: unknown): UIMessage[] | null {
  const parsed = chatBody.safeParse(body)
  if (!parsed.success) return null
  return parsed.data.messages.map((message, index) => ({
    id: message.id ?? `message-${index}`,
    role: message.role,
    parts: message.parts,
  }))
}

export const RATE_LIMIT_MAX_REQUESTS = 10
export const RATE_LIMIT_WINDOW_MS = 60_000

const hits = new Map<string, number[]>()

export function isRateLimited(key: string, now: number = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((at) => now - at < RATE_LIMIT_WINDOW_MS)
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    hits.set(key, recent)
    return true
  }
  recent.push(now)
  hits.set(key, recent)
  return false
}

export function clientKey(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}
