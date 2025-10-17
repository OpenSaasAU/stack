import { expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

// Extend Vitest matchers with jest-dom
expect.extend(matchers)

// Cleanup after each test
afterEach(() => {
  cleanup()
})
