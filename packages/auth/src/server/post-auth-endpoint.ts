import { parseSetCookieHeader } from 'better-auth/cookies'

export interface AuthContextShape {
  baseURL?: unknown
}

export interface AuthHandlerTarget {
  handler: (request: Request) => Promise<Response>
  $context: Promise<AuthContextShape> | (() => Promise<AuthContextShape>)
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

async function resolveBaseURL(auth: AuthHandlerTarget): Promise<URL | null> {
  const context = await (typeof auth.$context === 'function' ? auth.$context() : auth.$context)
  const { baseURL } = context
  if (typeof baseURL !== 'string' || baseURL.length === 0) return null
  return new URL(baseURL)
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
  const base = await resolveBaseURL(auth)
  if (base === null) {
    return {
      success: false,
      error: 'Auth base URL is not configured. Set BETTER_AUTH_URL.',
    }
  }
  const headers = new Headers(input.headers)
  for (const name of ['host', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded']) {
    headers.delete(name)
  }
  headers.set('content-type', 'application/json')
  headers.set('origin', base.origin)
  headers.delete('content-length')

  const response = await auth.handler(
    new Request(`${base.href.replace(/\/$/, '')}${input.path}`, {
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
