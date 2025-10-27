/**
 * OAuth Protected Resource Metadata Endpoint
 * Required for MCP clients to understand resource server capabilities
 *
 * Better Auth handles this automatically at /api/auth/.well-known/oauth-protected-resource
 * but some clients fail to parse WWW-Authenticate headers, so we expose it here too
 */

export async function GET(req: Request) {
  // Delegate to Better Auth's built-in handler
  const authUrl = new URL('/api/auth/.well-known/oauth-protected-resource', req.url)

  return fetch(authUrl.toString(), {
    headers: req.headers,
  })
}
