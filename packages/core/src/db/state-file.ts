import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'

/** The Generated bundle directory the state file lives in. */
const DEFAULT_BUNDLE_DIR = '.opensaas'

/** The state file's name inside the Generated bundle directory. */
const STATE_FILE_NAME = 'dev-db.json'

const stateSchema = z.object({
  url: z.string().min(1),
  pid: z.number().int().positive(),
})

/** What the Dev database sidecar publishes about itself: where it listens and who owns it. */
export type DevDatabaseState = z.infer<typeof stateSchema>

/** Where the state file is looked for, when it is not named outright. */
export interface DevDatabaseStateLocation {
  /**
   * The project root whose Generated bundle holds the state file.
   * Defaults to `process.cwd()`.
   */
  cwd?: string
  /** An explicit state file path, bypassing `cwd` and the bundle directory. */
  stateFile?: string
}

/** Resolves the absolute state file path for a location. */
export function devDatabaseStatePath(location: DevDatabaseStateLocation = {}): string {
  if (location.stateFile !== undefined) return path.resolve(location.stateFile)
  return path.join(location.cwd ?? process.cwd(), DEFAULT_BUNDLE_DIR, STATE_FILE_NAME)
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
 * Reads the Dev database state, or `undefined` when there is nothing usable
 * there: no file, unreadable JSON, a shape that is not the state file's, or a
 * pid that no longer names a running process. A crashed sidecar leaves its
 * file behind, so the pid is what tells a live database from a stale record.
 */
export function readDevDatabaseState(
  location: DevDatabaseStateLocation = {},
): DevDatabaseState | undefined {
  let contents: string
  try {
    contents = readFileSync(devDatabaseStatePath(location), 'utf8')
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    return undefined
  }
  const state = stateSchema.safeParse(parsed)
  if (!state.success) return undefined
  if (!isProcessAlive(state.data.pid)) return undefined
  return state.data
}

/** Writes the state file, creating the Generated bundle directory if needed. */
export function writeDevDatabaseState(filePath: string, state: DevDatabaseState): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(stateSchema.parse(state), null, 2)}\n`, 'utf8')
}

/**
 * Removes the state file, but only while it still describes `url` — a sidecar
 * shutting down must not delete the record a newer one wrote over it.
 */
export function clearDevDatabaseState(filePath: string, url: string): void {
  const state = readDevDatabaseState({ stateFile: filePath })
  if (state?.url !== url) return
  rmSync(filePath, { force: true })
}
