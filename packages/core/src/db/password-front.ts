import { timingSafeEqual } from 'node:crypto'
import { createConnection, createServer, type Server, type Socket } from 'node:net'

const SSL_REQUEST_CODE = 80877103
const GSS_ENC_REQUEST_CODE = 80877104
const CANCEL_REQUEST_CODE = 80877102
const HANDSHAKE_TIMEOUT_MS = 10_000
const PROTOCOL_VERSION_3 = 196608

const CLEARTEXT_PASSWORD_REQUEST = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 3])

function authenticationFailed(user: string): Buffer {
  const fields = [
    ['S', 'FATAL'],
    ['V', 'FATAL'],
    ['C', '28P01'],
    ['M', `password authentication failed for user "${user}"`],
  ] as const
  const body = Buffer.concat([
    ...fields.map(([code, text]) => Buffer.from(`${code}${text}\0`, 'utf8')),
    Buffer.from([0]),
  ])
  const header = Buffer.alloc(5)
  header.write('E', 0, 'latin1')
  header.writeUInt32BE(body.length + 4, 1)
  return Buffer.concat([header, body])
}

function startupUser(startup: Buffer): string {
  const parameters = startup.subarray(8).toString('utf8').split('\0')
  const index = parameters.indexOf('user')
  return index === -1 ? '' : (parameters[index + 1] ?? '')
}

function passwordMatches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

function admit(client: Socket, innerPath: string, password: string): void {
  let buffer = Buffer.alloc(0)
  let startup: Buffer | undefined
  let user = ''
  let settled = false

  const handshakeTimer = setTimeout(() => client.destroy(), HANDSHAKE_TIMEOUT_MS)
  client.once('close', () => clearTimeout(handshakeTimer))

  const reject = (): void => {
    settled = true
    client.removeListener('data', onData)
    client.end(authenticationFailed(user.replace(/[^\w.@-]/g, '?')))
  }

  const proxy = (leftover: Buffer): void => {
    settled = true
    clearTimeout(handshakeTimer)
    client.pause()
    client.removeListener('data', onData)
    const inner = createConnection(innerPath)
    inner.on('error', () => client.destroy())
    client.on('error', () => inner.destroy())
    client.once('close', () => inner.destroy())
    inner.once('close', () => client.destroy())
    inner.once('connect', () => {
      inner.write(startup as Buffer)
      if (leftover.length > 0) inner.write(leftover)
      client.pipe(inner)
      inner.pipe(client)
      client.resume()
    })
  }

  const onData = (chunk: Buffer): void => {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      if (settled) return
      if (startup === undefined) {
        if (buffer.length < 8) return
        const length = buffer.readUInt32BE(0)
        if (length < 8 || length > 10_000) return void client.destroy()
        if (buffer.length < length) return
        const code = buffer.readUInt32BE(4)
        const frame = buffer.subarray(0, length)
        buffer = buffer.subarray(length)
        if (code === SSL_REQUEST_CODE || code === GSS_ENC_REQUEST_CODE) {
          client.write('N')
          continue
        }
        if (code === CANCEL_REQUEST_CODE) {
          const inner = createConnection(innerPath)
          inner.on('error', () => undefined)
          inner.end(Buffer.from(frame))
          return void client.destroy()
        }
        if (code !== PROTOCOL_VERSION_3) return void client.destroy()
        startup = Buffer.from(frame)
        user = startupUser(startup)
        client.write(CLEARTEXT_PASSWORD_REQUEST)
        continue
      }
      if (buffer.length < 5) return
      if (buffer[0] !== 0x70) return void reject()
      const length = buffer.readUInt32BE(1)
      if (length < 5 || length > 10_000) return void reject()
      if (buffer.length < 1 + length) return
      const supplied = buffer.subarray(5, length).toString('utf8').replace(/\0$/, '')
      const leftover = Buffer.from(buffer.subarray(1 + length))
      if (!passwordMatches(supplied, password)) return void reject()
      proxy(leftover)
      return
    }
  }

  client.on('data', onData)
  client.on('error', () => client.destroy())
}

export interface PasswordFront {
  readonly port: number
  stop(): Promise<void>
}

export async function startPasswordFront(options: {
  host: string
  innerPath: string
  password: string
}): Promise<PasswordFront> {
  const sockets = new Set<Socket>()
  const server: Server = createServer((client) => {
    sockets.add(client)
    client.once('close', () => sockets.delete(client))
    admit(client, options.innerPath, options.password)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, options.host, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('The dev database password front reported no TCP port.')
  }
  return {
    port: address.port,
    stop: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
