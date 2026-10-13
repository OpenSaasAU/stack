import net from 'node:net'
import { mkdtempSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { timingSafeEqual, randomBytes } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import pg from 'pg'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const ef = promisify(execFile)

const PASSWORD = randomBytes(16).toString('hex')
const db = await PGlite.create()
const dir = mkdtempSync(path.join(tmpdir(), 'dd-'))
chmodSync(dir, 0o700)
const inner = new PGLiteSocketServer({ db, path: path.join(dir, 's'), maxConnections: 20 })
await inner.start()

const err = (msg) => {
  const b = Buffer.from(`SFATAL\0C28P01\0M${msg}\0\0`)
  const h = Buffer.alloc(5)
  h.write('E')
  h.writeInt32BE(b.length + 4, 1)
  return Buffer.concat([h, b])
}
const front = net.createServer((c) => {
  let buf = Buffer.alloc(0),
    stage = 'startup',
    startup
  const onData = (d) => {
    buf = Buffer.concat([buf, d])
    for (;;) {
      if (stage === 'startup') {
        if (buf.length < 8) return
        const len = buf.readInt32BE(0),
          code = buf.readInt32BE(4)
        if (code === 80877103) {
          c.write('N')
          buf = buf.subarray(8)
          continue
        }
        if (code === 80877102) {
          // cancel: forward as-is
          const u = net.connect(path.join(dir, 's'))
          u.end(buf.subarray(0, len))
          c.end()
          return
        }
        if (buf.length < len) return
        startup = buf.subarray(0, len)
        buf = buf.subarray(len)
        c.write(Buffer.from([82, 0, 0, 0, 8, 0, 0, 0, 3]))
        stage = 'password'
        continue
      }
      if (stage === 'password') {
        if (buf.length < 5) return
        const len = buf.readInt32BE(1)
        if (buf.length < 1 + len) return
        const pw = buf.subarray(5, 1 + len - 1)
        buf = buf.subarray(1 + len)
        const want = Buffer.from(PASSWORD)
        if (pw.length !== want.length || !timingSafeEqual(pw, want)) {
          c.end(err('password authentication failed'))
          return
        }
        c.off('data', onData)
        c.pause()
        const u = net.connect(path.join(dir, 's'), () => {
          u.write(startup)
          if (buf.length) u.write(buf)
          c.pipe(u)
          u.pipe(c)
          c.resume()
        })
        u.on('error', () => c.destroy())
        c.on('error', () => u.destroy())
        return
      }
    }
  }
  c.on('data', onData)
  c.on('error', () => {})
})
await new Promise((r) => front.listen(0, '127.0.0.1', r))
const port = front.address().port

let failures = 0
const t = async (name, fn, { expectReject = false } = {}) => {
  try {
    const v = await fn()
    if (expectReject) {
      failures++
      console.log(name, 'FAIL (connected, expected rejection)')
    } else console.log(name, 'OK', v)
  } catch (e) {
    if (expectReject) console.log(name, 'OK (rejected)')
    else {
      failures++
      console.log(name, 'FAIL', e.message)
    }
  }
}
const q = async (pw) => {
  const c = new pg.Client({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    database: 'postgres',
    password: pw,
  })
  await c.connect()
  const r = await c.query('select 1+1 as x')
  await c.end()
  return r.rows[0].x
}
await t('pg good pw', () => q(PASSWORD))
await t('pg bad pw', () => q('nope'), { expectReject: true })
await t('pg no pw', () => q(undefined), { expectReject: true })
await t('pool concurrent', async () => {
  const p = new pg.Pool({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    database: 'postgres',
    password: PASSWORD,
    max: 5,
  })
  const r = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => p.query('select $1::int as i', [i])))
  await p.end()
  return r.length
})
await t('url form', async () => {
  const c = new pg.Client({
    connectionString: `postgres://postgres:${PASSWORD}@127.0.0.1:${port}/postgres`,
  })
  await c.connect()
  await c.end()
  return 'ok'
})
const env = { ...process.env, PGSSLMODE: 'disable' }
const ps = async (url, e = env) =>
  (await ef('psql', [url, '-Atc', 'select 42'], { env: e, timeout: 20000 })).stdout.trim()
await t('psql good', async () => ps(`postgres://postgres:${PASSWORD}@127.0.0.1:${port}/postgres`))
await t('psql bad', async () => ps(`postgres://postgres:bad@127.0.0.1:${port}/postgres`), {
  expectReject: true,
})
await t('psql sslmode=prefer default', async () =>
  ps(`postgres://postgres:${PASSWORD}@127.0.0.1:${port}/postgres`, {
    ...process.env,
    PGSSLMODE: 'prefer',
  }),
)
front.close()
await inner.stop()
await db.close()
process.exit(failures === 0 ? 0 : 1)
