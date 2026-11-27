// The one module that imports the generated context factory. Everything else
// reaches the database through what it exports; `eslint.config.js` refuses
// any other import of `getContext`.
import { createProcedureHandler, createServerCaller } from '@opensaas/stack-core/procedures'
import { config, getContext } from '@/.opensaas/context'
import { getSession, getSessionFromHeaders } from '@/lib/auth'
import { procedures } from '@/lib/procedures'

const resolvedConfig = await config

const server = createServerCaller({
  procedures,
  config: resolvedConfig,
  getContext,
  getSession,
})

/** Call a procedure as the signed-in person, from a server action. */
export const callProcedure = server.call

/** The context for the current request's session, for a server component's reads. */
export const getServerContext = server.context

/** Serves `POST /api/procedures/<name>` for the browser client. */
export const handleProcedureRequest = createProcedureHandler({
  procedures,
  config: resolvedConfig,
  getContext,
  getSession: (request) => getSessionFromHeaders(request.headers),
  allowedOrigins: [process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'],
})
