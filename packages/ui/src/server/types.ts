export type { ServerActionProps as ServerActionInput } from '@opensaas/stack-core/internal'

export interface ActionResult<T = Record<string, unknown>> {
  success: boolean
  data?: T
  error?: string
  fieldErrors?: Record<string, string>
}
