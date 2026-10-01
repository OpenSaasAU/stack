import { spawn } from 'child_process'
import chalk from 'chalk'

export function quoteForCmd(arg: string): string {
  return `"${arg.replace(/"/g, '""').replace(/%/g, '"^%"')}"`
}

export function npxInvocation(
  args: string[],
  platform: typeof process.platform,
): { command: string; args: string[]; shell: boolean } {
  const all = ['create-opensaas-app@latest', ...args]
  if (platform === 'win32') {
    return { command: 'npx', args: all.map(quoteForCmd), shell: true }
  }
  return { command: 'npx', args: all, shell: false }
}

/**
 * Delegates to create-opensaas-app; kept for backwards compatibility with `opensaas init`.
 */
export async function initCommand(args: string[]) {
  console.log(chalk.dim('Delegating to create-opensaas-app...\n'))

  const invocation = npxInvocation(args, process.platform)
  const child = spawn(invocation.command, invocation.args, {
    stdio: 'inherit',
    shell: invocation.shell,
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
