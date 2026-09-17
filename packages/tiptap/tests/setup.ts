import { expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

expect.extend(matchers)

// @testing-library/jest-dom's own `vitest.d.ts` still augments the
// single-parameter `Assertion<T>` Vitest 4 shipped; Vitest 5 split it into
// `Assertion<R, T>` (return type, received value), so that augmentation binds
// jest-dom's members to the wrong slot and every matcher (toHaveAttribute,
// toBeInTheDocument, ...) disappears from the type. Re-declaring it here with
// the current arity is the fix until jest-dom ships one itself.
declare module 'vitest' {
  interface Assertion<
    R extends void | Promise<void> = void,
    T = unknown,
  > extends TestingLibraryMatchers<T, R> {}
}

afterEach(() => {
  cleanup()
})
