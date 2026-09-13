import { describe, expect, test } from 'vitest'
import {
  describeSelf,
  identifiesLiveProcess,
  isProcessAlive,
  processStartTime,
} from './process-identity.js'

/** No pid namespace on any supported platform runs this many processes at once. */
const UNUSED_PID = 2 ** 30

describe('isProcessAlive', () => {
  test('is true for this process', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })

  test('is false for a pid nothing runs', () => {
    expect(isProcessAlive(UNUSED_PID)).toBe(false)
  })
})

describe('processStartTime', () => {
  test('reports a plausible start time for this process on a supported platform', () => {
    const observed = processStartTime(process.pid)
    if (process.platform !== 'linux' && process.platform !== 'darwin') {
      expect(observed).toBeUndefined()
      return
    }

    if (observed === undefined) throw new Error('expected a start time on this platform')
    // This process has been running since before this assertion, and started
    // within the lifetime of this test run — a generous window either side
    // absorbs the two platforms' different measurement error.
    expect(observed).toBeLessThanOrEqual(Date.now())
    expect(observed).toBeGreaterThan(Date.now() - 24 * 60 * 60 * 1000)
  })

  test('is undefined for a pid nothing runs', () => {
    expect(processStartTime(UNUSED_PID)).toBeUndefined()
  })
})

describe('describeSelf', () => {
  test('names this process', () => {
    expect(describeSelf().pid).toBe(process.pid)
  })
})

describe('identifiesLiveProcess', () => {
  test('is true for this process, freshly described', () => {
    expect(identifiesLiveProcess(describeSelf())).toBe(true)
  })

  test('is false once the pid is dead, whatever startedAt says', () => {
    expect(identifiesLiveProcess({ pid: UNUSED_PID })).toBe(false)
    expect(identifiesLiveProcess({ pid: UNUSED_PID, startedAt: Date.now() })).toBe(false)
  })

  test('falls back to bare liveness when startedAt was never recorded', () => {
    expect(identifiesLiveProcess({ pid: process.pid })).toBe(true)
  })

  test('rejects a live pid whose recorded start time does not match', () => {
    const observed = processStartTime(process.pid)
    if (observed === undefined) return // unsupported platform: nothing to reject on

    expect(identifiesLiveProcess({ pid: process.pid, startedAt: observed - 60 * 60 * 1000 })).toBe(
      false,
    )
  })

  test('accepts a live pid whose recorded start time matches within tolerance', () => {
    const observed = processStartTime(process.pid)
    if (observed === undefined) return

    expect(identifiesLiveProcess({ pid: process.pid, startedAt: observed })).toBe(true)
  })
})
