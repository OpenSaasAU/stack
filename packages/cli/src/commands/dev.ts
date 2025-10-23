import * as path from 'path'
import * as fs from 'fs'
import chalk from 'chalk'
import chokidar from 'chokidar'
import { generateCommand } from './generate.js'

export async function devCommand() {
  const cwd = process.cwd()
  const configPath = path.join(cwd, 'opensaas.config.ts')

  // Check if config exists
  if (!fs.existsSync(configPath)) {
    console.error(chalk.red('Error: opensaas.config.ts not found in current directory'))
    console.error(chalk.gray('   Please run this command from your project root'))
    process.exit(1)
  }

  console.log(chalk.bold.cyan('\nOpenSaaS Dev Mode\n'))
  console.log(chalk.gray('Watching for changes to opensaas.config.ts...\n'))

  // Run initial generation
  await generateCommand()

  // Watch for changes
  const watcher = chokidar.watch(configPath, {
    persistent: true,
    ignoreInitial: true,
  })

  watcher.on('change', async () => {
    console.log(chalk.yellow('\nConfig changed, regenerating...\n'))
    await generateCommand()
  })

  watcher.on('error', (error) => {
    console.error(chalk.red('\nWatcher error:'), error)
  })

  // Keep the process running
  console.log(chalk.gray('Press Ctrl+C to stop watching\n'))

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\nStopping dev mode...'))
    watcher.close()
    process.exit(0)
  })
}
