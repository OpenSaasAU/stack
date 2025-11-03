import { spawn } from 'child_process'
import chalk from 'chalk'

/**
 * Initialize a new OpenSaas Stack project.
 *
 * This command delegates to create-opensaas-app for the actual scaffolding.
 * It's kept here for backwards compatibility with `opensaas init`.
 *
 * @param args - Command line arguments (project name and flags)
 */
export async function initCommand(args: string[]) {
  console.log(chalk.dim('Delegating to create-opensaas-app...\n'))

  // Forward all arguments to create-opensaas-app
  const child = spawn('npx', ['create-opensaas-app@latest', ...args], {
    stdio: 'inherit',
    shell: true,
  })

  return new Promise<void>((resolve, reject) => {
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`create-opensaas-app exited with code ${code}`))
      } else {
        resolve()
      }
    })

    child.on('error', (err) => {
      reject(err)
    })
  })
}
