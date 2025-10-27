/**
 * OAuth Authorization Server Metadata Endpoint
 * Required for MCP clients to discover OAuth endpoints
 *
 * Better Auth handles this automatically at /api/auth/.well-known/oauth-authorization-server
 * but some clients fail to parse WWW-Authenticate headers, so we expose it here too
 */

export async function GET(req: Request) {
  // Delegate to Better Auth's built-in handler
  const authUrl = new URL('/api/auth/.well-known/oauth-authorization-server', req.url)

  return fetch(authUrl.toString(), {
    headers: req.headers,
  })
}
