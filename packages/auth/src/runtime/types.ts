/**
 * Runtime services provided by the auth plugin, available via
 * `context.plugins.auth`.
 */
export interface AuthRuntimeServices {
  /**
   * Resolves through the plugin runtime's `sudo` helper, so the result does
   * not depend on the application's User list access policy (ADR-0013).
   *
   * @returns User object or null if not found
   */
  getUser: (userId: string) => Promise<unknown>

  /**
   * Extracts userId from session and fetches user data through the plugin
   * runtime's `sudo` helper — see {@link getUser}.
   *
   * @returns Current user object or null if not authenticated or not found
   */
  getCurrentUser: () => Promise<unknown>
}
