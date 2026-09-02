import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type Started = {
  db: PGlite
  server: PGLiteSocketServer
  url: string
  socketPath?: string
  port?: number
  ms: { pglite: number; socket: number; total: number }
  stop: () => Promise<void>
}

export async function startPglite(opts: { mode: 'unix' | 'tcp'; port?: number; maxConnections?: number; withVector?: boolean } = { mode: 'unix' }): Promise<Started> {
  const t0 = performance.now()
  const db = new PGlite({ extensions: opts.withVector === false ? {} : { vector } })
  await db.waitReady
  const t1 = performance.now()
  let server: PGLiteSocketServer
  let url: string
  let socketPath: string | undefined
  let port: number | undefined
  if (opts.mode === 'unix') {
    const dir = mkdtempSync(join(tmpdir(), 'pgl-'))
    socketPath = join(dir, '.s.PGSQL.5432')
    server = new PGLiteSocketServer({ db, path: socketPath, maxConnections: opts.maxConnections ?? 1 })
    url = `postgres://postgres@localhost/postgres?host=${encodeURIComponent(dir)}`
  } else {
    port = opts.port ?? 5400 + Math.floor(Math.random() * 100)
    server = new PGLiteSocketServer({ db, host: '127.0.0.1', port, maxConnections: opts.maxConnections ?? 1 })
    url = `postgres://postgres@127.0.0.1:${port}/postgres`
  }
  await server.start()
  const t2 = performance.now()
  return {
    db, server, url, socketPath, port,
    ms: { pglite: t1 - t0, socket: t2 - t1, total: t2 - t0 },
    stop: async () => { await server.stop(); await db.close() },
  }
}
