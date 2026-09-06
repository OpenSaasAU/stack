import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CONTROL_FILE,
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

  it('takes the control file down with the channel', async () => {
    channel = await startControlChannel(projectDir, async () => {})
    expect(fs.existsSync(path.join(projectDir, CONTROL_FILE))).toBe(true)

    await channel.close()
    channel = undefined

    expect(fs.existsSync(path.join(projectDir, CONTROL_FILE))).toBe(false)
  })
})
