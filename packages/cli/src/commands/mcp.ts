/**
 * MCP command group for AI-assisted development
 */

import { Command } from 'commander'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function getServerPath(): string {
  // In development: cli/dist/mcp/server/index.js
  // In production: same structure
  return join(__dirname, '..', 'mcp', 'server', 'index.js')
}

function installMCPServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('📦 Installing OpenSaaS Stack MCP server...\n')

    const serverPath = getServerPath()
    const claudeCommand = ['claude', 'mcp', 'add', 'opensaas-stack', '--', 'node', serverPath]

    console.log(`Running: ${claudeCommand.join(' ')}\n`)

    const child = spawn(claudeCommand[0], claudeCommand.slice(1), {
      stdio: 'inherit',
    })

    child.on('close', (code) => {
      if (code === 0) {
        console.log('\n✅ OpenSaaS Stack MCP server installed successfully!')
        console.log('\n📖 Available tools:')
        console.log('  - opensaas_implement_feature')
        console.log('  - opensaas_feature_docs')
        console.log('  - opensaas_list_features')
        console.log('  - opensaas_suggest_features')
        console.log('  - opensaas_validate_feature')
        console.log('\n🚀 Restart Claude Code to use the MCP tools.')
        resolve()
      } else {
        console.error(
          `\n❌ Installation failed with code ${code}. Please ensure Claude Code is installed.`,
        )
        reject(new Error(`Installation failed with code ${code}`))
      }
    })

    child.on('error', (error) => {
      console.error('\n❌ Error during installation:', error.message)
      console.error('\nMake sure Claude Code is installed and the "claude" command is available.')
      reject(error)
    })
  })
}

function uninstallMCPServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('🗑️  Uninstalling OpenSaaS Stack MCP server...\n')

    const child = spawn('claude', ['mcp', 'remove', 'opensaas-stack'], {
      stdio: 'inherit',
    })

    child.on('close', (code) => {
      if (code === 0) {
        console.log('\n✅ OpenSaaS Stack MCP server uninstalled successfully.')
        resolve()
      } else {
        console.error(`\n❌ Uninstall failed with code ${code}`)
        reject(new Error(`Uninstall failed with code ${code}`))
      }
    })

    child.on('error', (error) => {
      console.error('\n❌ Error during uninstall:', error.message)
      reject(error)
    })
  })
}

function startMCPServer(): void {
  console.log('🚀 Starting OpenSaaS Stack MCP server...\n')

  const serverPath = getServerPath()

  const child = spawn('node', [serverPath], {
    stdio: 'inherit',
  })

  child.on('error', (error) => {
    console.error('❌ Error starting server:', error.message)
    process.exit(1)
  })
}

export function createMCPCommand(): Command {
  const mcp = new Command('mcp')
  mcp.description('MCP server for AI-assisted development with Claude Code')

  mcp
    .command('install')
    .description('Install MCP server in Claude Code')
    .action(async () => {
      try {
        await installMCPServer()
        process.exit(0)
      } catch {
        process.exit(1)
      }
    })

  mcp
    .command('uninstall')
    .description('Remove MCP server from Claude Code')
    .action(async () => {
      try {
        await uninstallMCPServer()
        process.exit(0)
      } catch {
        process.exit(1)
      }
    })

  mcp
    .command('start')
    .description('Start MCP server directly (for debugging)')
    .action(() => {
      startMCPServer()
    })

  return mcp
}
