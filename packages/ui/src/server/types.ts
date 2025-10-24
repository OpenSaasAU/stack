/**
 * Input for the generic server action
 * Re-exported from @opensaas/framework-core for convenience
 */
export type { ServerActionProps as ServerActionInput } from '@opensaas/framework-core'

/**
 * Result of a server action
 */
export interface ActionResult<T = Record<string, unknown>> {
  success: boolean
  data?: T
  error?: string
  fieldErrors?: Record<string, string>
}
