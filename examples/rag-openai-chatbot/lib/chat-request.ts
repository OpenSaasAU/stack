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
  parts: z
    .array(z.unknown())
    .max(MAX_PARTS_PER_MESSAGE)
    .transform((parts) =>
      parts.flatMap((part) => {
        const parsed = textPart.safeParse(part)
        return parsed.success ? [parsed.data] : []
      })
    ),
})

const chatBody = z.object({
  messages: z.array(chatMessage).min(1).max(MAX_MESSAGES),
})

export const MAX_TOTAL_LENGTH = 20_000

export function parseChatBody(body: unknown): UIMessage[] | null {
  const parsed = chatBody.safeParse(body)
  if (!parsed.success) return null
  const messages = parsed.data.messages
    .filter((message) => message.parts.length > 0)
    .map((message, index) => ({
      id: message.id ?? `message-${index}`,
      role: message.role,
      parts: message.parts,
    }))
  const last = messages[messages.length - 1]
  if (last === undefined || last.role !== 'user') return null
  const total = messages.reduce(
    (sum, message) => sum + message.parts.reduce((n, part) => n + part.text.length, 0),
    0
  )
  return total > MAX_TOTAL_LENGTH ? null : messages
}

export const RATE_LIMIT_MAX_REQUESTS = 10
export const RATE_LIMIT_WINDOW_MS = 60_000

const MAX_TRACKED_KEYS = 10_000
const hits = new Map<string, number[]>()

export function isRateLimited(key: string, now: number = Date.now()): boolean {
  if (hits.size > MAX_TRACKED_KEYS) {
    for (const [k, times] of hits) {
      if (times.every((at) => now - at >= RATE_LIMIT_WINDOW_MS)) hits.delete(k)
    }
  }
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
