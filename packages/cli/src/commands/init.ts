import { spawn } from 'child_process'
import chalk from 'chalk'

/**
 * Delegates to create-opensaas-app; kept for backwards compatibility with `opensaas init`.
 */
export async function initCommand(args: string[]) {
  console.log(chalk.dim('Delegating to create-opensaas-app...\n'))

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
