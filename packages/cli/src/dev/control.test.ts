import * as fs from 'fs'
import * as os from 'os'
import * as net from 'net'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CONTROL_FILE,
  DevLoopUnreachableError,
  NoDevLoopError,
  requestDatabaseUpdate,
  startControlChannel,
  type ControlChannel,
  type ControlRequest,
} from './control.js'

describe('the dev loop control channel', () => {
  let projectDir: string
  let channel: ControlChannel | undefined

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-control-'))
  })

  afterEach(async () => {
    await channel?.close()
    channel = undefined
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  it('carries the consent tokens to the loop and the loop’s words back', async () => {
    const seen: ControlRequest[] = []
    channel = await startControlChannel(projectDir, async (request, reply) => {
      seen.push(request)
      reply.log('planning')
      reply.finish(true, 'applied')
    })

    const said: string[] = []
    const ok = await requestDatabaseUpdate(projectDir, ['postgres'], (message) =>
      said.push(message),
    )

    expect(ok).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.confirm).toEqual(['postgres'])
    expect(said).toEqual(['planning', 'applied'])
  })

  it('reports a refusal as a failed request', async () => {
    channel = await startControlChannel(projectDir, async (_request, reply) => {
      reply.finish(false, 'the database is unchanged')
    })

    const said: string[] = []
    expect(await requestDatabaseUpdate(projectDir, [], (message) => said.push(message))).toBe(false)
    expect(said).toContain('the database is unchanged')
  })

  it('refuses a request that does not carry the published token', async () => {
    let handled = false
    channel = await startControlChannel(projectDir, async () => {
      handled = true
    })

    const file = path.join(projectDir, CONTROL_FILE)
    const published = JSON.parse(fs.readFileSync(file, 'utf-8'))
    fs.writeFileSync(file, JSON.stringify({ ...published, token: 'guessed' }), 'utf-8')

    expect(await requestDatabaseUpdate(projectDir, [], () => {})).toBe(false)
    expect(handled).toBe(false)
  })

  it('names `opensaas dev` when no loop is listening', async () => {
    await expect(requestDatabaseUpdate(projectDir, [], () => {})).rejects.toThrow(NoDevLoopError)
    await expect(requestDatabaseUpdate(projectDir, [], () => {})).rejects.toThrow('opensaas dev')
  })

  it('names `opensaas dev` when the control file outlived the loop that wrote it', async () => {
    fs.mkdirSync(path.join(projectDir, '.opensaas'), { recursive: true })
    fs.writeFileSync(
      path.join(projectDir, CONTROL_FILE),
      JSON.stringify({ pid: 2 ** 30, port: 1, token: 'stale' }),
      'utf-8',
    )

    await expect(requestDatabaseUpdate(projectDir, [], () => {})).rejects.toThrow(NoDevLoopError)
  })

  it('publishes the control file 0600 over one pre-created world-readable', async () => {
    const file = path.join(projectDir, CONTROL_FILE)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{}', 'utf-8')
    fs.chmodSync(file, 0o666)

    channel = await startControlChannel(projectDir, async () => {})

    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })

  it('does not follow a symlink planted at the control file path', async () => {
    const file = path.join(projectDir, CONTROL_FILE)
    const decoy = path.join(projectDir, 'harvested.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(decoy, 'nothing yet', 'utf-8')
    fs.symlinkSync(decoy, file)

    channel = await startControlChannel(projectDir, async () => {})

    expect(fs.lstatSync(file).isSymbolicLink()).toBe(false)
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(fs.readFileSync(decoy, 'utf-8')).toBe('nothing yet')
  })

  it('publishes no channel when the control file path cannot hold a file', async () => {
    fs.mkdirSync(path.join(projectDir, CONTROL_FILE), { recursive: true })

    await expect(startControlChannel(projectDir, async () => {})).rejects.toThrow()
  })

  it('reports a drop mid-exchange as the loop stopping, not as no loop running', async () => {
    channel = await startControlChannel(projectDir, async () => {
      await new Promise(() => {})
    })

    const closing = channel
    channel = undefined
    setTimeout(() => {
      void closing.close()
    }, 50)

    await expect(requestDatabaseUpdate(projectDir, [], () => {})).rejects.toThrow(
      DevLoopUnreachableError,
    )
  })

  it('closes without waiting on a connection the loop is still serving', async () => {
    let serving!: () => void
    channel = await startControlChannel(projectDir, async () => {
      await new Promise<void>((resolve) => {
        serving = resolve
      })
    })
    const published = JSON.parse(fs.readFileSync(path.join(projectDir, CONTROL_FILE), 'utf-8'))

    const parked = net.createConnection({ host: '127.0.0.1', port: published.port })
    await new Promise<void>((resolve) => parked.once('connect', () => resolve()))
    parked.on('error', () => {})
    parked.write(
      `${JSON.stringify({ token: published.token, command: 'db-update', confirm: [] })}\n`,
    )
    await new Promise((resolve) => setTimeout(resolve, 50))

    const closing = channel
    channel = undefined
    await expect(
      Promise.race([
        closing.close(),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('hung')), 2000)),
      ]),
    ).resolves.toBeUndefined()

    serving()
    parked.destroy()
  })

  it('takes the control file down with the channel', async () => {
    channel = await startControlChannel(projectDir, async () => {})
    expect(fs.existsSync(path.join(projectDir, CONTROL_FILE))).toBe(true)

    await channel.close()
    channel = undefined

    expect(fs.existsSync(path.join(projectDir, CONTROL_FILE))).toBe(false)
  })
})
