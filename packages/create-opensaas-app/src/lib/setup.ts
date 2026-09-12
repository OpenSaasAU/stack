/**
 * Post-scaffold setup plan and "next steps" messaging.
 *
 * The CLI runs install → generate for the user so the documented flow
 * collapses to three steps: scaffold → `pnpm dev` → build with Claude. There is
 * no schema-apply step: scaffolding reaches no database, and the first
 * `pnpm dev` starts one and reconciles it (ADR-0063). The ordered plan, the
 * per-step recovery message, and the final next-steps commands are pure
 * data/string functions here so they can be unit-tested; the actual process
 * spawning lives in the CLI orchestrator.
 */

const PACKAGE_MANAGER = 'pnpm'

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
  /** Whether install/generate already ran during scaffolding. */
  autoRan: boolean
}

/** install → generate, in order. */
export function planSetupSteps(): SetupStep[] {
  return [
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
 * sequence.
 */
export function nextStepCommands(options: NextStepsOptions): string[] {
  const { projectName, autoRan } = options
  if (autoRan) {
    return [`cd ${projectName}`, `${PACKAGE_MANAGER} dev`]
  }
  return [
    `cd ${projectName}`,
    `${PACKAGE_MANAGER} install`,
    `${PACKAGE_MANAGER} generate`,
    `${PACKAGE_MANAGER} dev`,
  ]
}
