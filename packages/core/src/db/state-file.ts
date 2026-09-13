import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import { identifiesLiveProcess, processClaimSchema, processStartTime } from './process-identity.js'

/** The Generated bundle directory the state file lives in. */
const DEFAULT_BUNDLE_DIR = '.opensaas'

/** The state file's name inside the Generated bundle directory. */
const STATE_FILE_NAME = 'dev-db.json'

const stateSchema = processClaimSchema.extend({
  url: z.string().min(1),
})

/** What the Dev database sidecar publishes about itself: where it listens and who owns it. */
export type DevDatabaseState = z.infer<typeof stateSchema>

/**
 * What a caller writing the state file provides — `startedAt` is derived from
 * the sidecar's own pid at write time, never supplied by the caller.
 */
export type PublishedDevDatabaseState = Omit<DevDatabaseState, 'startedAt'>

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

/**
 * Reads the Dev database state, or `undefined` when there is nothing usable
 * there: no file, unreadable JSON, a shape that is not the state file's, or a
 * pid that no longer identifies the sidecar that wrote it — either because
 * nothing runs there anymore, or because a reboot or pid wrap has handed that
 * pid to an unrelated process (see {@link identifiesLiveProcess}). A crashed
 * sidecar leaves its file behind; this is what tells a live database from a
 * stale record.
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
  if (!identifiesLiveProcess(state.data)) return undefined
  return state.data
}

/**
 * Writes the state file, creating the Generated bundle directory if needed.
 * The write goes to a sibling temp file and is renamed into place, so a reader
 * never observes a half-written record. `startedAt` is stamped from `pid`'s
 * own start time (best-effort — see {@link processStartTime}), not taken from
 * `state`: only the sidecar itself is in a position to look this up.
 */
export function writeDevDatabaseState(filePath: string, state: PublishedDevDatabaseState): void {
  const directory = path.dirname(filePath)
  mkdirSync(directory, { recursive: true })
  const record: DevDatabaseState = { ...state, startedAt: processStartTime(state.pid) }
  const contents = `${JSON.stringify(stateSchema.parse(record), null, 2)}\n`
  const temporary = path.join(directory, `${path.basename(filePath)}.${process.pid}.tmp`)
  try {
    writeFileSync(temporary, contents, 'utf8')
    renameSync(temporary, filePath)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
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
