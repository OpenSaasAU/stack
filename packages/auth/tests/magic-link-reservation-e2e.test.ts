import { describe, it, expect } from 'vitest'
import { createAuth } from '../src/server/index.js'
import { generateProject, toolchainPresent } from './generated-project.js'

const guardEnabled = process.env.RUN_MAGIC_LINK_E2E === '1'
const prerequisitesPresent = guardEnabled && toolchainPresent()

const configSource = `import { config } from '@opensaas/stack-core'
import { authPlugin } from '@opensaas/stack-auth'
import { magicLink } from 'better-auth/plugins'

Reflect.set(globalThis, '__magicLinks', [])

export default config({
  plugins: [
    authPlugin({
      emailAndPassword: { enabled: true },
      betterAuthPlugins: [
        magicLink({
          sendMagicLink: async ({ url }) => {
            const links = Reflect.get(globalThis, '__magicLinks')
            if (Array.isArray(links)) links.push(url)
          },
        }),
      ],
    }),
  ],
  db: { provider: 'postgresql' },
  lists: {},
})
`

describe.skipIf(!prerequisitesPresent)('magicLink reservation id — live end-to-end (#1918)', () => {
  it('signs an unverified email+password user in by link', async () => {
    const project = await generateProject('magic-link-e2e', configSource, {
      BETTER_AUTH_SECRET: 'e2e-test-secret-not-for-production-0000000000',
      BETTER_AUTH_URL: 'http://localhost:3000',
    })
    try {
      const auth = createAuth(project.config, project.context)
      const email = 'unverified@example.com'

      const signUp = await auth.handler(
        new Request('http://localhost:3000/api/auth/sign-up/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
          body: JSON.stringify({ email, password: 'correct-horse-battery', name: 'Unverified' }),
        }),
      )
      expect(signUp.status).toBe(200)

      const request = await auth.handler(
        new Request('http://localhost:3000/api/auth/sign-in/magic-link', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
          body: JSON.stringify({ email }),
        }),
      )
      expect(request.status).toBe(200)

      const links: unknown = Reflect.get(globalThis, '__magicLinks')
      const link = Array.isArray(links) ? links.at(-1) : undefined
      if (typeof link !== 'string') throw new Error('no magic link was sent')
      const verify = await auth.handler(
        new Request(link, { headers: { origin: 'http://localhost:3000' } }),
      )
      expect(verify.headers.get('location') ?? '').not.toContain('error=')
      expect(verify.status).toBe(302)
      expect(verify.headers.get('set-cookie')).toContain('session_token')
    } finally {
      await project.close()
    }
  }, 180_000)
})
