import { randomBytes } from 'crypto'
import * as fs from 'fs'
import * as net from 'net'
import * as path from 'path'
import { z } from 'zod'

/**
 * The control channel between a second-terminal `opensaas db update` and the
 * `opensaas dev` loop serving the project.
 *
 * The loop is the only process that may run the reconcile: PGlite's data
 * directory is open in the loop, every other process reaches the database
 * through the sidecar's single multiplexed backend, and only the loop holds
 * the staged generation and the app child it has to restart. So the second
 * terminal opens no database connection at all — it asks the loop, and prints
 * what the loop reports.
 */

/** The control file, inside the Generated bundle beside the Dev database's. */
export const CONTROL_FILE = path.join('.opensaas', 'dev-loop.json')

const controlFileSchema = z.object({
  pid: z.number().int().positive(),
  port: z.number().int().positive(),
  token: z.string().min(1),
})

const requestSchema = z.object({
  token: z.string(),
  command: z.literal('db-update'),
  confirm: z.array(z.string()).default([]),
})

/** What a second terminal asked the loop to do. */
export type ControlRequest = z.infer<typeof requestSchema>

/** One line the loop sends back while it works, and the one that ends the exchange. */
export type ControlMessage =
  | { readonly kind: 'log'; readonly message: string }
  | { readonly kind: 'result'; readonly ok: boolean; readonly message: string }

/** The loop's side of one exchange: what it may say, and how it ends. */
export interface ControlReply {
  log(message: string): void
  finish(ok: boolean, message: string): void
}

/** A running control channel. */
export interface ControlChannel {
  readonly port: number
  /** Absolute path of the control file this channel published. */
  readonly file: string
  /** Stops listening and removes the control file. */
  close(): Promise<void>
  /** Removes the control file without waiting on the socket, for an `'exit'` listener. */
  clearFile(): void
}

function controlFilePath(cwd: string): string {
  return path.join(cwd, CONTROL_FILE)
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

/**
 * Opens the loop's control channel on a free loopback port and publishes it.
 *
 * The token is checked on every request: the port is reachable by anything
 * running as any user on this machine, and a request makes the loop run a
 * schema change.
 *
 * @param handler - Runs the request and reports through {@link ControlReply}.
 */
export async function startControlChannel(
  cwd: string,
  handler: (request: ControlRequest, reply: ControlReply) => Promise<void>,
): Promise<ControlChannel> {
  const token = randomBytes(24).toString('hex')

  const sockets = new Set<net.Socket>()

  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.setEncoding('utf-8')
    let buffered = ''
    let handled = false

    const send = (message: ControlMessage): void => {
      if (socket.writableEnded) return
      socket.write(`${JSON.stringify(message)}\n`)
    }

    socket.on('data', (chunk: string) => {
      if (handled) return
      buffered += chunk
      const newline = buffered.indexOf('\n')
      if (newline === -1) return
      handled = true

      let parsed: unknown
      try {
        parsed = JSON.parse(buffered.slice(0, newline))
      } catch {
        send({ kind: 'result', ok: false, message: 'Unreadable control request.' })
        socket.end()
        return
      }

      const request = requestSchema.safeParse(parsed)
      if (!request.success || request.data.token !== token) {
        send({ kind: 'result', ok: false, message: 'Control request refused.' })
        socket.end()
        return
      }

      let finished = false
      const reply: ControlReply = {
        log: (message) => send({ kind: 'log', message }),
        finish: (ok, message) => {
          if (finished) return
          finished = true
          send({ kind: 'result', ok, message })
          socket.end()
        },
      }

      handler(request.data, reply)
        .then(() => reply.finish(true, 'Done.'))
        .catch((error: unknown) => {
          reply.finish(false, error instanceof Error ? error.message : String(error))
        })
    })

    socket.on('error', () => socket.destroy())
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('The dev loop control channel bound no TCP port.')
  }

  const file = controlFilePath(cwd)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // `mode` reaches open(2) and so applies only to a file this call creates,
  // and writeFileSync follows symlinks. Removing whatever is there first is
  // what makes 0600 hold over a pre-created world-readable file, and stops a
  // planted symlink redirecting the token somewhere readable.
  fs.rmSync(file, { force: true })
  fs.writeFileSync(
    file,
    `${JSON.stringify({ pid: process.pid, port: address.port, token }, null, 2)}\n`,
    {
      encoding: 'utf-8',
      mode: 0o600,
    },
  )

  const clearFile = (): void => {
    fs.rmSync(file, { force: true })
  }

  return {
    port: address.port,
    file,
    clearFile,
    async close() {
      clearFile()
      const closed = new Promise<void>((resolve) => server.close(() => resolve()))
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      await closed
    },
  }
}

/** Thrown when no `opensaas dev` loop is listening in this project. */
export class NoDevLoopError extends Error {
  constructor() {
    super(
      'No `opensaas dev` loop is running in this project. `db update` applies the staged ' +
        'schema change against the Dev database the loop owns and restarts the app it is ' +
        'serving, so start `opensaas dev` in another terminal first.',
    )
    this.name = 'NoDevLoopError'
  }
}

/** Thrown when the loop was reached but the exchange broke off part-way. */
export class DevLoopUnreachableError extends Error {
  constructor() {
    super(
      'The `opensaas dev` loop stopped responding while applying the schema change. It may ' +
        'have applied part of it, so check that terminal\u2019s output before retrying.',
    )
    this.name = 'DevLoopUnreachableError'
  }
}

/**
 * Asks the running loop to reconcile and promote, printing what it reports.
 *
 * @returns whether the loop reported success.
 * @throws {NoDevLoopError} when no loop is listening.
 * @throws {DevLoopUnreachableError} when the connection drops mid-exchange.
 */
export async function requestDatabaseUpdate(
  cwd: string,
  confirm: readonly string[],
  log: (message: string) => void,
): Promise<boolean> {
  let published: z.infer<typeof controlFileSchema>
  try {
    published = controlFileSchema.parse(JSON.parse(fs.readFileSync(controlFilePath(cwd), 'utf-8')))
  } catch {
    throw new NoDevLoopError()
  }
  if (!isProcessAlive(published.pid)) throw new NoDevLoopError()

  return await new Promise<boolean>((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: published.port })
    socket.setEncoding('utf-8')

    let buffered = ''
    let settled = false
    let connected = false
    const settle = (outcome: boolean): void => {
      if (settled) return
      settled = true
      resolve(outcome)
      socket.end()
    }

    socket.once('connect', () => {
      connected = true
      socket.write(
        `${JSON.stringify({ token: published.token, command: 'db-update', confirm: [...confirm] })}\n`,
      )
    })

    socket.on('data', (chunk: string) => {
      buffered += chunk
      for (;;) {
        const newline = buffered.indexOf('\n')
        if (newline === -1) break
        const line = buffered.slice(0, newline)
        buffered = buffered.slice(newline + 1)
        if (line.trim().length === 0) continue
        let message: ControlMessage
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        if (message.kind === 'log') log(message.message)
        else {
          log(message.message)
          settle(message.ok)
        }
      }
    })

    // Ending without a result line is the loop going away mid-exchange, which
    // is not the same as finding no listener at all: the schema change may be
    // half applied, so this must not send the user off to start a second loop.
    const abandon = (): void => {
      if (settled) return
      settled = true
      reject(connected ? new DevLoopUnreachableError() : new NoDevLoopError())
    }

    socket.once('error', abandon)
    socket.once('close', abandon)
  })
}
