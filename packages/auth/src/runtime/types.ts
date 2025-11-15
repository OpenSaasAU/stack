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
   * Get user by ID
   * Uses the access-controlled context to fetch user data
   *
   * @param userId - The ID of the user to fetch
   * @returns User object or null if not found or access denied
   */
  getUser: (userId: string) => Promise<unknown>

  /**
   * Get current user from session
   * Extracts userId from session and fetches user data
   *
   * @returns Current user object or null if not authenticated or not found
   */
  getCurrentUser: () => Promise<unknown>
}
