// Replays the Field Visibility catalogue under each implementation, one child
// process apiece, and reports the first entry and key where they disagree (#2408).

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { CATALOGUE_ENTRIES } from './fixtures/field-visibility-catalogue-entries.js'

const RUN = 300_000

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const vitestBin = path.join(packageRoot, 'node_modules/vitest/vitest.mjs')
const catalogue = 'src/secured/field-visibility-catalogue.test.ts'
const scratch = mkdtempSync(path.join(tmpdir(), 'opensaas-field-visibility-'))

type Implementation = 'old' | 'new'

interface Replay {
  readonly observations: unknown
  readonly exitCode: number | null
  readonly output: string
}

function childEnvironment(
  implementation: Implementation,
  out: string,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('VITEST') || key === 'NODE_V8_COVERAGE' || key === 'TEST') continue
    env[key] = value
  }
  env.OPENSAAS_FIELD_VISIBILITY = implementation
  env.OPENSAAS_FIELD_VISIBILITY_CATALOGUE_OUT = out
  return env
}

function replay(implementation: Implementation): Promise<Replay> {
  const out = path.join(scratch, `${implementation}.json`)
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [vitestBin, 'run', catalogue, '--reporter=dot'], {
      cwd: packageRoot,
      env: childEnvironment(implementation, out),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.on('error', reject)
    child.on('close', (exitCode) => {
      let observations: unknown
      try {
        observations = JSON.parse(readFileSync(out, 'utf8'))
      } catch (error) {
        reject(
          new Error(`the ${implementation} replay wrote no observations:\n${output}`, {
            cause: error,
          }),
        )
        return
      }
      resolve({ observations, exitCode, output })
    })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function show(value: unknown): string {
  return value === undefined ? 'nothing' : JSON.stringify(value)
}

/** The first path at which `left` and `right` differ, keys and their order included. */
function firstDifference(left: unknown, right: unknown, at = ''): string | undefined {
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length)
    for (let index = 0; index < length; index++) {
      const found = firstDifference(left[index], right[index], `${at}[${index}]`)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    const keys = [...new Set([...leftKeys, ...rightKeys])]
    for (const key of keys) {
      const found = firstDifference(left[key], right[key], `${at}.${key}`)
      if (found !== undefined) return found
    }
    if (leftKeys.join('\0') !== rightKeys.join('\0')) {
      return `${at} (key order): old ${show(leftKeys)}, new ${show(rightKeys)}`
    }
    return undefined
  }
  if (Object.is(left, right)) return undefined
  return `${at}: old ${show(left)}, new ${show(right)}`
}

function observedEntries(observations: unknown): string[] {
  return isRecord(observations) ? Object.keys(observations).sort() : []
}

/** One line per diverging catalogue entry, naming the entry and its first differing key. */
function divergences(old: unknown, next: unknown): string[] {
  if (!isRecord(old) || !isRecord(next)) return ['the replays wrote no catalogue']
  const entries = [...new Set([...Object.keys(old), ...Object.keys(next)])]
  const found: string[] = []
  for (const entry of entries) {
    const difference = firstDifference(old[entry], next[entry])
    if (difference !== undefined) found.push(`"${entry}" diverged at ${difference}`)
  }
  return found
}

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('Field Visibility under the walks and the single traversal', () => {
  test(
    'every catalogue entry returns the same rows through the same calls and statements',
    async () => {
      const [old, next] = await Promise.all([replay('old'), replay('new')])

      const expected = [...CATALOGUE_ENTRIES].sort()
      expect({
        old: observedEntries(old.observations),
        new: observedEntries(next.observations),
      }).toEqual({ old: expected, new: expected })
      expect(divergences(old.observations, next.observations)).toEqual([])
      expect({ old: old.exitCode, new: next.exitCode }, `${old.output}\n${next.output}`).toEqual({
        old: 0,
        new: 0,
      })
    },
    RUN,
  )
})

describe('the divergence report', () => {
  test('names the entry and the first differing key, order included', () => {
    expect(
      divergences(
        { read: { result: [{ id: 1, a: 1, b: 2 }], calls: [['x'], ['y']] } },
        { read: { result: [{ id: 1, b: 2, a: 1 }], calls: [['y'], ['x']] } },
      ),
    ).toEqual(['"read" diverged at .result[0] (key order): old ["id","a","b"], new ["id","b","a"]'])
    expect(
      divergences({ read: { calls: [['x'], ['y']] } }, { read: { calls: [['y'], ['x']] } }),
    ).toEqual(['"read" diverged at .calls[0][0]: old "x", new "y"'])
    expect(divergences({ read: { result: { a: 1 } } }, { read: { result: {} } })).toEqual([
      '"read" diverged at .result.a: old 1, new nothing',
    ])
  })

  test('compares call counts exactly', () => {
    const assembled = (id: number) => ['assembleColumns', 'card', id]
    const read = ['read', 'Player.rating', 'p1']
    const old = { read: { calls: [assembled(1), assembled(2), read, assembled(1), assembled(2)] } }

    expect(divergences(old, old)).toEqual([])
    expect(divergences(old, { read: { calls: [assembled(1), assembled(2), read] } })).toEqual([
      '"read" diverged at .calls[3]: old ["assembleColumns","card",1], new nothing',
    ])
    expect(divergences({ read: { calls: [read, read] } }, { read: { calls: [read] } })).toEqual([
      '"read" diverged at .calls[1]: old ["read","Player.rating","p1"], new nothing',
    ])
  })
})
