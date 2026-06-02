/**
 * Post-scaffold setup plan and "next steps" messaging.
 *
 * The CLI runs install → generate → db:push for the user so the documented
 * flow collapses to three steps: scaffold → `pnpm dev` → build with Claude.
 * The ordered plan, the per-step recovery message, and the final next-steps
 * commands are pure data/string functions here so they can be unit-tested; the
 * actual process spawning lives in the CLI orchestrator.
 */

const PACKAGE_MANAGER = 'pnpm'

/** Databases the scaffolder can target. Mirrors `DbProvider` in `env.ts`. */
export type DbProvider = 'sqlite' | 'postgresql'

export interface SetupStep {
  /** Label shown while the step runs. */
  title: string
  /** Arguments passed to the package manager (e.g. ['run', 'generate']). */
  args: string[]
  /** The command the user can run to retry just this step. */
  retry: string
}

export interface NextStepsOptions {
  projectName: string
  /** Whether install/generate/db:push already ran during scaffolding. */
  autoRan: boolean
  /** The database the project targets (defaults to SQLite). */
  provider?: DbProvider
}

/**
 * install → generate → db:push, in order.
 *
 * For PostgreSQL we omit `db:push`: it needs a live database the user hasn't
 * configured yet (the scaffolded `.env` holds placeholder connection strings),
 * so attempting it would always fail. SQLite's `db:push` creates a local file
 * with no setup, so it stays in the auto-run.
 */
export function planSetupSteps(provider: DbProvider = 'sqlite'): SetupStep[] {
  const steps: SetupStep[] = [
    {
      title: 'Installing dependencies',
      args: ['install'],
      retry: `${PACKAGE_MANAGER} install`,
    },
    {
      title: 'Generating schema and types',
      args: ['run', 'generate'],
      retry: `${PACKAGE_MANAGER} generate`,
    },
  ]

  if (provider === 'sqlite') {
    steps.push({
      title: 'Creating the database',
      args: ['run', 'db:push'],
      retry: `${PACKAGE_MANAGER} db:push`,
    })
  }

  return steps
}

/** Actionable, recoverable message for a setup step that failed. */
export function formatStepFailure(step: SetupStep, projectName: string): string {
  return (
    `"${step.title}" didn't finish. Once you've resolved the issue, run:\n\n` +
    `  cd ${projectName}\n` +
    `  ${step.retry}`
  )
}

/**
 * The commands to print under "Next steps". When setup ran automatically the
 * user only needs to start the dev server; otherwise they get the full manual
 * sequence. A PostgreSQL project lists `migrate` (it needs a real database the
 * user must configure first) rather than the SQLite `db:push`.
 */
export function nextStepCommands(options: NextStepsOptions): string[] {
  const { projectName, autoRan, provider = 'sqlite' } = options
  if (autoRan) {
    return [`cd ${projectName}`, `${PACKAGE_MANAGER} dev`]
  }
  const applySchema =
    provider === 'postgresql' ? `${PACKAGE_MANAGER} migrate` : `${PACKAGE_MANAGER} db:push`
  return [
    `cd ${projectName}`,
    `${PACKAGE_MANAGER} install`,
    `${PACKAGE_MANAGER} generate`,
    applySchema,
    `${PACKAGE_MANAGER} dev`,
  ]
}
