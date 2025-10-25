/**
 * Input for the generic server action
 * Re-exported from @opensaas/stack-core for convenience
 */
export type { ServerActionProps as ServerActionInput } from '@opensaas/stack-core'

/**
 * Result of a server action
 */
export interface ActionResult<T = Record<string, unknown>> {
  success: boolean
  data?: T
  error?: string
  fieldErrors?: Record<string, string>
}
