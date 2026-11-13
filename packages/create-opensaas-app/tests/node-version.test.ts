import { describe, expect, test } from 'vitest'
import { nodeVersionError } from '../src/lib/node-version.js'

describe('nodeVersionError', () => {
  test.each(['20.12.2', '22.12.0', '22.17.9', '18.0.0'])('rejects %s naming the floor', (v) => {
    expect(nodeVersionError(v)).toContain('22.18.0')
  })

  test.each(['22.18.0', '22.18.1', '23.0.0', '24.3.0'])('accepts %s', (v) => {
    expect(nodeVersionError(v)).toBeNull()
  })
})
