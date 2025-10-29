import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// Mock chokidar
const mockWatcherOn = vi.fn()
const mockWatcherClose = vi.fn()
const mockWatch = vi.fn(() => ({
  on: mockWatcherOn,
  close: mockWatcherClose,
}))

vi.mock('chokidar', () => ({
  default: {
    watch: mockWatch,
  },
}))

// Mock the generate command
vi.mock('./generate.js', () => ({
  generateCommand: vi.fn().mockResolvedValue(undefined),
}))

// Mock ora
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: '',
  })),
}))

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    bold: {
      cyan: vi.fn((str) => str),
    },
    cyan: vi.fn((str) => str),
    gray: vi.fn((str) => str),
    red: vi.fn((str) => str),
    yellow: vi.fn((str) => str),
  },
}))

describe('Dev Command', () => {
  let tempDir: string
  let originalCwd: string
  let originalExit: typeof process.exit
  let exitCode: number | undefined

  beforeEach(() => {
    vi.clearAllMocks()

    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-test-'))
    originalCwd = process.cwd()
    process.chdir(tempDir)

    // Mock process.exit
    originalExit = process.exit
    exitCode = undefined
    process.exit = vi.fn((code?: number) => {
      exitCode = code
      throw new Error(`process.exit(${code})`)
    }) as never

    // Create opensaas.config.ts file
    fs.writeFileSync(
      path.join(tempDir, 'opensaas.config.ts'),
      `
      import { config } from '@opensaas/stack-core'
      export default config({
        db: { provider: 'sqlite', url: 'file:./dev.db' },
        lists: {}
      })
    `,
    )
  })

  afterEach(() => {
    // Restore
    process.chdir(originalCwd)
    process.exit = originalExit

    // Clean up
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('devCommand', () => {
    it('should fail if config file does not exist', async () => {
      // Remove config file
      fs.unlinkSync(path.join(tempDir, 'opensaas.config.ts'))

      const { devCommand } = await import('./dev.js')

      try {
        await devCommand()
      } catch {
        // Expected to throw
      }

      expect(exitCode).toBe(1)
    })

    it('should call generateCommand initially', async () => {
      const { generateCommand } = await import('./generate.js')
      const { devCommand } = await import('./dev.js')

      // Run dev command in background (don't await)
      devCommand().catch(() => {
        // Ignore errors
      })

      // Wait a bit for initial generation
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(generateCommand).toHaveBeenCalled()
    })

    it('should set up file watcher for config file', async () => {
      const { devCommand } = await import('./dev.js')

      // Run dev command
      devCommand().catch(() => {
        // Ignore errors
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Verify watcher was set up
      expect(mockWatch).toHaveBeenCalled()
      expect(mockWatch.mock.calls.length).toBeGreaterThan(0)

      const watchPath = mockWatch.mock.calls[0]![0]
      expect(watchPath).toContain('opensaas.config.ts')

      const watchOptions = mockWatch.mock.calls[0]![1]
      expect(watchOptions).toMatchObject({
        persistent: true,
        ignoreInitial: true,
      })
    })

    it('should register change event handler', async () => {
      const { devCommand } = await import('./dev.js')

      devCommand().catch(() => {
        // Ignore errors
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(mockWatcherOn).toHaveBeenCalledWith('change', expect.any(Function))
    })

    it('should register error event handler', async () => {
      const { devCommand } = await import('./dev.js')

      devCommand().catch(() => {
        // Ignore errors
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(mockWatcherOn).toHaveBeenCalledWith('error', expect.any(Function))
    })

    it('should regenerate on config file change', async () => {
      const { generateCommand } = await import('./generate.js')
      const { devCommand } = await import('./dev.js')

      devCommand().catch(() => {
        // Ignore errors
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Simulate file change
      const changeHandler = mockWatcherOn.mock.calls.find((call) => call[0] === 'change')?.[1]
      expect(changeHandler).toBeDefined()

      if (changeHandler) {
        await changeHandler()
      }

      // generateCommand should be called again
      expect(vi.mocked(generateCommand).mock.calls.length).toBeGreaterThan(1)
    })

    it('should close watcher on SIGINT', async () => {
      const { devCommand } = await import('./dev.js')

      devCommand().catch(() => {
        // Ignore errors
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Simulate SIGINT - catch the error from process.exit
      try {
        process.emit('SIGINT', 'SIGINT')
      } catch {
        // Expected to throw from process.exit mock
      }

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(mockWatcherClose).toHaveBeenCalled()
    })
  })
})
