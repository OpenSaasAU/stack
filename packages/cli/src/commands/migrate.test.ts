import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  MIGRATION_GUIDE_URL,
  MIGRATION_PLUGIN_ID,
  MIGRATION_PLUGIN_INSTALL_STEPS,
  printMigrationResources,
  createMigrateCommand,
} from './migrate.js'

// chalk is mocked to a pass-through so assertions see plain text without ANSI codes.
vi.mock('chalk', () => {
  const passthrough = (str: string) => str
  return {
    default: {
      bold: Object.assign(passthrough, { cyan: passthrough }),
      cyan: passthrough,
      dim: passthrough,
      gray: passthrough,
      red: passthrough,
      yellow: passthrough,
      green: passthrough,
    },
  }
})

describe('migrate command discoverability', () => {
  describe('canonical pointers', () => {
    it('points at the published Keystone migration guide', () => {
      expect(MIGRATION_GUIDE_URL).toBe(
        'https://stack.opensaas.au/docs/guides/migrating-from-keystone',
      )
    })

    it('identifies the opensaas-migration plugin from the stack marketplace', () => {
      expect(MIGRATION_PLUGIN_ID).toBe('opensaas-migration@opensaas-stack-marketplace')
    })

    it('manual install steps add the marketplace and install the plugin', () => {
      expect(MIGRATION_PLUGIN_INSTALL_STEPS).toEqual([
        '/plugin marketplace add OpenSaasAU/stack',
        '/plugin install opensaas-migration@opensaas-stack-marketplace',
      ])
    })
  })

  describe('printMigrationResources', () => {
    let logSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    })

    afterEach(() => {
      logSpy.mockRestore()
    })

    function capturedOutput(): string {
      return logSpy.mock.calls.map((call) => call.join(' ')).join('\n')
    }

    it('prints the published guide URL', () => {
      printMigrationResources()
      expect(capturedOutput()).toContain(MIGRATION_GUIDE_URL)
    })

    it('prints the opensaas-migration plugin install pointer', () => {
      printMigrationResources()
      const output = capturedOutput()
      // The plugin id and the manual install command must both be surfaced.
      expect(output).toContain(MIGRATION_PLUGIN_ID)
      expect(output).toContain(`/plugin install ${MIGRATION_PLUGIN_ID}`)
      expect(output).toContain('/plugin marketplace add OpenSaasAU/stack')
      // ...and the automatic path that wires the plugin up.
      expect(output).toContain('npx @opensaas/stack-cli migrate --with-ai')
    })
  })

  describe('migrate --help output', () => {
    it('includes the guide URL and the plugin install pointer', () => {
      const command = createMigrateCommand()

      // addHelpText('after', ...) is appended when help is rendered via
      // outputHelp(), so capture what the command actually writes.
      let helpText = ''
      command.configureOutput({
        writeOut: (str) => {
          helpText += str
        },
      })
      command.outputHelp()

      expect(helpText).toContain(MIGRATION_GUIDE_URL)
      expect(helpText).toContain(`/plugin install ${MIGRATION_PLUGIN_ID}`)
      expect(helpText).toContain('/plugin marketplace add OpenSaasAU/stack')
    })
  })
})
