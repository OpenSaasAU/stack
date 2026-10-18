import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  MIGRATION_GUIDE_URL,
  MIGRATION_PLUGIN_ID,
  MIGRATION_PLUGIN_INSTALL_STEPS,
  printMigrationResources,
  createMigrateCommand,
  setupClaudeCode,
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
        'https://stack.opensaas.au/docs/how-to/migrate-from-keystone',
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
      return logSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n')
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

describe('setupClaudeCode', () => {
  let cwd: string

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-migrate-'))
  })

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true })
  })

  it('refuses to overwrite an unparseable settings.json', async () => {
    const settingsPath = path.join(cwd, '.claude', 'settings.json')
    fs.mkdirSync(path.dirname(settingsPath))
    const original = '{ "permissions": { "allow": ["Bash"], }, }'
    fs.writeFileSync(settingsPath, original)

    await expect(setupClaudeCode(cwd, { projectTypes: ['prisma'], cwd })).rejects.toThrow(
      /Could not parse .*settings\.json/,
    )
    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(original)
    expect(fs.existsSync(path.join(cwd, '.claude', 'opensaas-project.json'))).toBe(false)
  })

  it.each(['null', '[]', '"text"'])('refuses non-object settings.json (%s)', async (content) => {
    const settingsPath = path.join(cwd, '.claude', 'settings.json')
    fs.mkdirSync(path.dirname(settingsPath))
    fs.writeFileSync(settingsPath, content)

    await expect(setupClaudeCode(cwd, { projectTypes: ['prisma'], cwd })).rejects.toThrow(
      /expected a JSON object/,
    )
    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(content)
  })

  it('defaults the recorded provider to postgresql', async () => {
    await setupClaudeCode(cwd, { projectTypes: ['prisma'], cwd })

    const metadata = JSON.parse(
      fs.readFileSync(path.join(cwd, '.claude', 'opensaas-project.json'), 'utf-8'),
    )
    expect(metadata.provider).toBe('postgresql')
  })
})
