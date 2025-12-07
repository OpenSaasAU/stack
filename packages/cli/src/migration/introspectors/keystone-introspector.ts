/**
 * KeystoneJS config introspector - Stub for Phase 4
 *
 * This will analyze KeystoneJS config files and extract list/field information
 */

import type { IntrospectedSchema } from '../types.js'

export class KeystoneIntrospector {
  /**
   * Introspect a KeystoneJS config file
   *
   * @param cwd - Current working directory
   * @param configPath - Path to keystone.config.ts relative to cwd
   * @returns Parsed config information
   */
  async introspect(_cwd: string, _configPath: string): Promise<IntrospectedSchema> {
    // Stub - will be implemented in Phase 4
    throw new Error(
      'KeystoneIntrospector not yet implemented. This will be available in Phase 4 of the migration system.',
    )
  }
}
