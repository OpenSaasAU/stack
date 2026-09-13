import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { z } from 'zod'

/** A pid, and — where the platform can supply one — when that pid started. */
export const processClaimSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.number().positive().optional(),
})

/** What a process recorded about itself, for a later reader to check against. */
export type ProcessClaim = z.infer<typeof processClaimSchema>

/** Whether `pid` names a process this machine still runs. `EPERM` counts as alive. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

/** Linux reports ticks since boot at this rate on every architecture this primitive targets. */
const LINUX_CLOCK_TICKS_PER_SECOND = 100

/** Index of `starttime` among the fields following `/proc/<pid>/stat`'s `)`-terminated comm. */
const STAT_STARTTIME_FIELD_INDEX = 19

function linuxProcessStartTime(pid: number): number | undefined {
  let stat: string
  let uptimeSeconds: string
  try {
    stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    uptimeSeconds = readFileSync('/proc/uptime', 'utf8').split(' ')[0] ?? ''
  } catch {
    return undefined
  }

  // `comm` (the second field) is wrapped in parens and may itself contain
  // ")" or spaces, so the fields before it are unsafe to split on — only the
  // last ")" is guaranteed to end it.
  const afterComm = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  const startTicks = Number(afterComm[STAT_STARTTIME_FIELD_INDEX])
  const uptime = Number(uptimeSeconds)
  if (!Number.isFinite(startTicks) || !Number.isFinite(uptime)) return undefined

  const bootEpochMs = Date.now() - uptime * 1000
  return Math.round(bootEpochMs + (startTicks / LINUX_CLOCK_TICKS_PER_SECOND) * 1000)
}

function macosProcessStartTime(pid: number): number | undefined {
  let output: string
  try {
    output = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // `ps` renders weekday/month names and `Date.parse` reads them back in
      // the process's own locale; forcing C here keeps the two in the same
      // locale regardless of the caller's — an unpinned locale would parse to
      // `Invalid Date` under a non-English one and silently disable this.
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    }).trim()
  } catch {
    return undefined
  }
  if (output.length === 0) return undefined
  const parsed = new Date(output)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.getTime()
}

/**
 * A process's own start time in epoch milliseconds — best-effort, and never
 * exact. `undefined` on a platform this cannot introspect (anything but
 * Linux and macOS) or when the lookup itself fails, including for a pid that
 * is not currently running.
 *
 * Linux divides `/proc/<pid>/stat`'s ticks-since-boot by an assumed 100 Hz
 * clock; macOS shells to `ps -o lstart=`, which only carries one-second
 * resolution. Callers compare with tolerance, never for exact equality.
 */
export function processStartTime(pid: number): number | undefined {
  if (process.platform === 'linux') return linuxProcessStartTime(pid)
  if (process.platform === 'darwin') return macosProcessStartTime(pid)
  return undefined
}

/** What this process should record about itself in a claim it publishes. */
export function describeSelf(): ProcessClaim {
  return { pid: process.pid, startedAt: processStartTime(process.pid) }
}

/**
 * Start times are compared with slack, not for exact equality: the two
 * readings come from different measurements taken seconds apart (Linux's
 * assumed clock rate, macOS's one-second `ps` resolution), so a real match
 * still drifts by up to a couple of seconds.
 */
const START_TIME_TOLERANCE_MS = 2_000

/**
 * Whether `claim` still names the process that published it — not merely a
 * pid that happens to be alive right now. A pid outlives the reboot or wrap
 * that hands it to an unrelated process, so bare liveness cannot tell the
 * two apart; comparing recorded and freshly observed start times can, on the
 * platforms {@link processStartTime} supports.
 *
 * Where neither reading is available — `claim.startedAt` was never recorded,
 * or this platform cannot look one up now — the check degrades to bare pid
 * liveness, exactly as it did before this comparison existed.
 */
export function identifiesLiveProcess(claim: ProcessClaim): boolean {
  if (!isProcessAlive(claim.pid)) return false
  if (claim.startedAt === undefined) return true
  const observed = processStartTime(claim.pid)
  if (observed === undefined) return true
  return Math.abs(observed - claim.startedAt) <= START_TIME_TOLERANCE_MS
}
