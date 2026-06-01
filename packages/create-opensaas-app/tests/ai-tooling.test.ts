import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import { aiBundlePaths, removeAiTooling } from '../src/lib/ai-tooling.js'

/**
 * Build a fake scaffolded project containing the full AI bundle (a project
 * `CLAUDE.md` and a `.claude/` directory with settings) plus an unrelated file
 * that must always survive.
 */
async function scaffoldProjectWithAiBundle(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-opensaas-app-'))
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), '# project rules\n')
  await fs.ensureDir(path.join(dir, '.claude'))
  await fs.writeJSON(path.join(dir, '.claude', 'settings.json'), { mcpServers: {} })
  // An unrelated project file the opt-out must never touch.
  await fs.writeFile(path.join(dir, 'opensaas.config.ts'), 'export default {}\n')
  return dir
}

describe('removeAiTooling', () => {
  let projectDir: string

  beforeEach(async () => {
    projectDir = await scaffoldProjectWithAiBundle()
  })

  afterEach(async () => {
    await fs.remove(projectDir)
  })

  it('keeps the AI bundle when AI tooling is enabled (enableMCP = true)', async () => {
    const removed = await removeAiTooling(projectDir, true)

    expect(removed).toEqual([])
    expect(await fs.pathExists(path.join(projectDir, 'CLAUDE.md'))).toBe(true)
    expect(await fs.pathExists(path.join(projectDir, '.claude'))).toBe(true)
    expect(await fs.pathExists(path.join(projectDir, '.claude', 'settings.json'))).toBe(true)
  })

  it('removes the AI bundle when AI tooling is disabled (enableMCP = false)', async () => {
    const removed = await removeAiTooling(projectDir, false)

    expect(removed).toEqual([...aiBundlePaths])
    expect(await fs.pathExists(path.join(projectDir, 'CLAUDE.md'))).toBe(false)
    expect(await fs.pathExists(path.join(projectDir, '.claude'))).toBe(false)
  })

  it('leaves unrelated project files untouched when opting out', async () => {
    await removeAiTooling(projectDir, false)

    expect(await fs.pathExists(path.join(projectDir, 'opensaas.config.ts'))).toBe(true)
  })

  it('only reports paths that actually existed', async () => {
    // A project that somehow lacks `.claude` (e.g. a template without it) must
    // not error and must only report what it actually removed.
    await fs.remove(path.join(projectDir, '.claude'))

    const removed = await removeAiTooling(projectDir, false)

    expect(removed).toEqual(['CLAUDE.md'])
    expect(await fs.pathExists(path.join(projectDir, 'CLAUDE.md'))).toBe(false)
  })
})
