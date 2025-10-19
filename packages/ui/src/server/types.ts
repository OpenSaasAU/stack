/**
 * Input for the generic server action
 */
export interface ServerActionInput {
  listKey: string;
  action: "create" | "update" | "delete";
  data?: Record<string, unknown>;
  id?: string;
}

/**
 * Result of a server action
 */
export interface ActionResult<T = Record<string, unknown>> {
  success: boolean;
  data?: T;
  error?: string;
  fieldErrors?: Record<string, string>;
}
