import { describe, expect, test } from 'vitest'
import * as testing from './index.js'

describe('the testing entry point', () => {
  test('offers no helper that types a nullable rule as a boolean one', () => {
    expect(Object.keys(testing)).not.toContain('untypedRule')
  })
})
