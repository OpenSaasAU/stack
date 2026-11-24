import { auth } from '@/lib/auth'
import { hasAuthBaseURL, MISSING_BASE_URL_MESSAGE } from '@/lib/base-url'

function handle(request: Request): Promise<Response> | Response {
  if (!hasAuthBaseURL()) {
    return Response.json({ error: MISSING_BASE_URL_MESSAGE }, { status: 500 })
  }
  return auth.handler(request)
}

export const GET = handle
export const POST = handle
