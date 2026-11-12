import { parseSetCookieHeader } from 'better-auth/cookies'

export interface AuthHandlerTarget {
  handler: (request: Request) => Promise<Response>
  options: { baseURL?: unknown; basePath?: unknown }
}

export type PostAuthEndpointResult = { success: true } | { success: false; error: string }

export interface PostAuthEndpointInput {
  path: string
  body: Record<string, unknown>
  headers: Headers
  setCookie?: (name: string, value: string, options: PostAuthCookieOptions) => void
}

export interface PostAuthCookieOptions {
  path?: string
  domain?: string
  maxAge?: number
  expires?: Date
  secure?: boolean
  httpOnly?: boolean
  partitioned?: boolean
  sameSite?: 'strict' | 'lax' | 'none'
}

function originFor(auth: AuthHandlerTarget, headers: Headers): string {
  if (typeof auth.options.baseURL === 'string' && auth.options.baseURL.length > 0) {
    return new URL(auth.options.baseURL).origin
  }
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost:3000'
  const proto =
    headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

async function errorFrom(response: Response, fallback: string): Promise<string> {
  const payload: unknown = await response.json().catch(() => null)
  if (typeof payload === 'object' && payload !== null) {
    const message = Reflect.get(payload, 'message')
    if (typeof message === 'string' && message.length > 0) return message
  }
  return response.status === 429 ? 'Too many requests. Please try again later.' : fallback
}

/**
 * POSTs to a better-auth endpoint through `auth.handler`, so the rate limiter
 * (which only runs in the handler) applies. Pass `setCookie` to persist
 * `Set-Cookie` headers, e.g. Next's `cookies().set`.
 */
export async function postAuthEndpoint(
  auth: AuthHandlerTarget,
  input: PostAuthEndpointInput,
): Promise<PostAuthEndpointResult> {
  try {
    return await dispatch(auth, input)
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error && err.message ? err.message : 'Request failed',
    }
  }
}

async function dispatch(
  auth: AuthHandlerTarget,
  input: PostAuthEndpointInput,
): Promise<PostAuthEndpointResult> {
  const basePath = typeof auth.options.basePath === 'string' ? auth.options.basePath : '/api/auth'
  const origin = originFor(auth, input.headers)
  const headers = new Headers(input.headers)
  headers.set('content-type', 'application/json')
  headers.set('origin', origin)
  headers.delete('content-length')

  const response = await auth.handler(
    new Request(`${origin}${basePath}${input.path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input.body),
    }),
  )

  if (!response.ok) return { success: false, error: await errorFrom(response, 'Request failed') }

  const header = response.headers.get('set-cookie')
  if (header && input.setCookie) {
    for (const [name, attributes] of parseSetCookieHeader(header)) {
      input.setCookie(name, attributes.value, {
        path: attributes.path,
        domain: attributes.domain,
        maxAge: attributes['max-age'],
        expires: attributes.expires,
        secure: attributes.secure,
        httpOnly: attributes.httponly,
        partitioned: attributes.partitioned,
        sameSite: attributes.samesite,
      })
    }
  }
  return { success: true }
}
