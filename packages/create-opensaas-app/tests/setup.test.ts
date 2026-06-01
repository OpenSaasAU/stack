import { describe, it, expect } from 'vitest'
import { planSetupSteps, formatStepFailure, nextStepCommands } from '../src/lib/setup.js'

describe('planSetupSteps', () => {
  const steps = planSetupSteps()

  it('runs install, then generate, then db:push in order', () => {
    expect(steps.map((s) => s.args)).toEqual([['install'], ['run', 'generate'], ['run', 'db:push']])
  })

  it('gives every step a retry command and a title', () => {
    for (const step of steps) {
      expect(step.title).toBeTruthy()
      expect(step.retry).toMatch(/^pnpm /)
    }
  })
})

describe('formatStepFailure', () => {
  it('names the failed step and how to retry it from the project', () => {
    const [, generateStep] = planSetupSteps()
    const message = formatStepFailure(generateStep, 'my-app')
    expect(message).toContain('Generating schema and types')
    expect(message).toContain('cd my-app')
    expect(message).toContain('pnpm generate')
  })
})

describe('nextStepCommands', () => {
  it('asks only for `pnpm dev` when setup already ran (the 3-step flow)', () => {
    const commands = nextStepCommands({ projectName: 'my-app', autoRan: true })
    expect(commands).toEqual(['cd my-app', 'pnpm dev'])
    expect(commands.join('\n')).not.toContain('pnpm install')
  })

  it('falls back to the full manual sequence when setup was skipped', () => {
    const commands = nextStepCommands({ projectName: 'my-app', autoRan: false })
    expect(commands).toEqual([
      'cd my-app',
      'pnpm install',
      'pnpm generate',
      'pnpm db:push',
      'pnpm dev',
    ])
  })
})
