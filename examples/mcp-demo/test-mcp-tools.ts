/**
 * Drive this project's MCP tools end to end: the derived CRUD tools for `Post`
 * and the two custom tools the config registers.
 *
 * Run with `pnpm test`, which is `opensaas dev -- tsx test-mcp-tools.ts`: the
 * Dev database is up and reconciled before the script starts and stopped again
 * when it exits. `DATABASE_URL` set points it at a Postgres of your own.
 *
 * It builds the same `createMcpHandlers` the route does and posts real
 * JSON-RPC at it, so tool derivation, argument validation, access control and
 * the writes are the real ones. What it substitutes is the session provider:
 * over HTTP that is better-auth's OAuth, and an access token needs a browser
 * to authorise. Here the session is supplied directly, which is exactly what
 * the adapter would have resolved the bearer token to.
 */

import assert from 'node:assert/strict'
import { createMcpHandlers } from '@opensaas/stack-core/mcp'
import type { McpSession } from '@opensaas/stack-core/mcp'
import config from './opensaas.config.ts'
import { getContext } from './.opensaas/context.ts'
import { auth } from './lib/auth.ts'

const AUTHOR = { name: 'MCP Author', email: 'mcp-author@example.com', password: 'mcp-password-1' }

type JsonRpcResult = {
  jsonrpc?: string
  id?: number | string | null
  result?: { tools?: { name: string }[]; content?: { type: string; text: string }[] }
  error?: { code: number; message: string }
}

let checks = 0

async function check(label: string, assertion: () => void | Promise<void>): Promise<void> {
  await assertion()
  checks += 1
  console.log(`  ✓ ${label}`)
}

/** The text payload a tool result carries, parsed back out of the MCP envelope. */
function toolPayload(body: JsonRpcResult): unknown {
  const text = body.result?.content?.[0]?.text
  assert(typeof text === 'string', `tool returned no content: ${JSON.stringify(body)}`)
  return JSON.parse(text)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown, key: string): string {
  assert(isRecord(value), `expected an object, got ${JSON.stringify(value)}`)
  const field = value[key]
  assert(typeof field === 'string', `expected "${key}" to be a string in ${JSON.stringify(value)}`)
  return field
}

/** The row a write tool answers with, out of its `{ success, item }` envelope. */
function writtenItem(payload: unknown): Record<string, unknown> {
  assert(isRecord(payload) && payload.success === true, `write failed: ${JSON.stringify(payload)}`)
  const item = payload.item
  assert(isRecord(item), `write returned no item: ${JSON.stringify(payload)}`)
  return item
}

/** The rows a query tool answers with, out of its `{ items, count }` envelope. */
function queriedItems(payload: unknown): Record<string, unknown>[] {
  assert(
    isRecord(payload) && Array.isArray(payload.items),
    `query failed: ${JSON.stringify(payload)}`,
  )
  return payload.items.filter(isRecord)
}

async function main(): Promise<void> {
  // The rows belong to a user this script invented, and no session it holds may
  // delete another's, so the teardown runs elevated. Re-runnable as a result.
  const elevated = (await getContext()).sudo()
  for (const post of await elevated.db.Post.all()) {
    await elevated.db.Post.delete({ where: { id: post.id } })
  }
  for (const user of await elevated.db.User.all()) {
    await elevated.db.User.delete({ where: { id: user.id } })
  }

  const signUp = await auth.api.signUpEmail({ body: AUTHOR })
  const userId = signUp.user.id

  let session: McpSession | null = { userId, scopes: ['openid', 'profile', 'email'] }
  const { POST } = createMcpHandlers({
    config: await config,
    getSession: async () => session,
    getContext,
  })

  const call = async (method: string, params?: unknown): Promise<JsonRpcResult> => {
    const response = await POST(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }),
    )
    assert.equal(response.status, 200, `${method} answered ${response.status}`)
    return (await response.json()) as JsonRpcResult
  }

  const tool = async (name: string, args: unknown): Promise<unknown> =>
    toolPayload(await call('tools/call', { name, arguments: args }))

  console.log('\nDiscovery')
  const listed = await call('tools/list')
  const names = (listed.result?.tools ?? []).map((t) => t.name)
  await check('the derived CRUD tools for Post are advertised', () => {
    for (const expected of [
      'list_post_query',
      'list_post_create',
      'list_post_update',
      'list_post_delete',
    ]) {
      assert(names.includes(expected), `${expected} missing from ${names.join(', ')}`)
    }
  })
  await check('the two custom tools are advertised beside them', () => {
    assert(names.includes('publishPost'))
    assert(names.includes('unpublishPost'))
  })

  console.log('\nWrites')
  const created = writtenItem(
    await tool('list_post_create', {
      data: {
        title: 'Written over MCP',
        slug: 'written-over-mcp',
        content: 'The create tool goes through the same write pipeline as context.db.',
        author: { connect: { id: userId } },
      },
    }),
  )
  const postId = readString(created, 'id')
  await check('create returns the row it wrote, unpublished', () => {
    assert.equal(readString(created, 'title'), 'Written over MCP')
    assert.equal(readString(created, 'status'), 'draft')
    assert.equal(readString(created, 'authorId'), userId)
  })

  await check('update writes through the same pipeline', async () => {
    const updated = writtenItem(
      await tool('list_post_update', {
        where: { id: postId },
        data: { content: 'Edited over MCP.' },
      }),
    )
    assert.equal(readString(updated, 'content'), 'Edited over MCP.')
  })

  console.log('\nCustom tools')
  await check('publishPost publishes and stamps publishedAt', async () => {
    const published = await tool('publishPost', { postId })
    assert(isRecord(published) && isRecord(published.post))
    assert.equal(published.post.status, 'published')
    assert.notEqual(published.post.publishedAt, null)
  })
  await check('unpublishPost clears the stamp again', async () => {
    const unpublished = await tool('unpublishPost', { postId })
    assert(isRecord(unpublished) && isRecord(unpublished.post))
    assert.equal(unpublished.post.status, 'draft')
    assert.equal(unpublished.post.publishedAt, null)
  })

  console.log('\nReads')
  await check('query returns the row, filtered in the Where vocabulary', async () => {
    const queried = queriedItems(
      await tool('list_post_query', { where: { slug: { equals: 'written-over-mcp' } } }),
    )
    assert.equal(queried.length, 1)
    assert.equal(readString(queried[0], 'title'), 'Written over MCP')
  })
  await check('query honours a fields projection', async () => {
    const projected = queriedItems(
      await tool('list_post_query', {
        where: { id: { equals: postId } },
        fields: { title: true },
      }),
    )
    assert.equal(projected.length, 1)
    assert.equal(readString(projected[0], 'title'), 'Written over MCP')
    assert.equal('content' in projected[0], false)
  })

  console.log('\nAccess control')
  await check('a request with no session is refused with the OAuth challenge', async () => {
    session = null
    const refused = await POST(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    )
    assert.equal(refused.status, 401)
    assert.match(refused.headers.get('WWW-Authenticate') ?? '', /^Bearer realm="\/api\/mcp"/)
    session = { userId, scopes: ['openid', 'profile', 'email'] }
  })

  console.log('\nDeletes')
  await check('delete removes the row', async () => {
    const deleted = await tool('list_post_delete', { where: { id: postId } })
    assert(isRecord(deleted) && deleted.success === true)
    assert.equal(deleted.deletedId, postId)
    const remaining = queriedItems(
      await tool('list_post_query', { where: { id: { equals: postId } } }),
    )
    assert.equal(remaining.length, 0)
  })

  console.log(`\n✅ ${checks} checks passed`)
}

main().catch((error: unknown) => {
  console.error('\n❌ Suite failed:', error)
  process.exitCode = 1
})
