// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as internal from '@opensaas/stack-core/internal'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

const EVALUATORS =
  /\b(checkFieldAccess|checkAccess|checkCreateAccess|classifyRowIndependent\w*|classifyWriteForRow)\b/

const RULE_READ = /\.access\??\.(operation|read|create|update|delete)\b/

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return await sourceFiles(path)
      return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
    }),
  )
  return nested.flat()
}

async function offendingLines(pattern: RegExp): Promise<string[]> {
  const offences: string[] = []
  for (const file of await sourceFiles(SRC)) {
    const lines = (await readFile(file, 'utf8')).split('\n')
    lines.forEach((line, index) => {
      if (pattern.test(line)) offences.push(`${relative(SRC, file)}:${index + 1}: ${line.trim()}`)
    })
  }
  return offences
}

describe('the admin package classifies access only through the Session vocabulary', () => {
  it('names no access evaluator from core', async () => {
    expect(await offendingLines(EVALUATORS)).toEqual([])
  })

  it('reads no access rule off a list or field config', async () => {
    expect(await offendingLines(RULE_READ)).toEqual([])
  })

  it('cannot reach the field-access evaluator through core’s internal entry point', () => {
    expect(Object.keys(internal)).not.toContain('checkFieldAccess')
  })
})
