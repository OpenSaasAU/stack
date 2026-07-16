/**
 * Type definitions for auth plugin runtime services
 * These types are used for type-safe access to context.plugins.auth
 */

/**
 * Runtime services provided by the auth plugin
 * Available via context.plugins.auth
 */
export interface AuthRuntimeServices {
  /**
   * Get user by ID.
   * Resolves through the plugin runtime's `sudo` helper, so the result does
   * not depend on the application's User list access policy (ADR-0013).
   *
   * @param userId - The ID of the user to fetch
   * @returns User object or null if not found
   */
  getUser: (userId: string) => Promise<unknown>

  /**
   * Get current user from session.
   * Extracts userId from session and fetches user data through the plugin
   * runtime's `sudo` helper — see {@link getUser}.
   *
   * @returns Current user object or null if not authenticated or not found
   */
  getCurrentUser: () => Promise<unknown>
}
