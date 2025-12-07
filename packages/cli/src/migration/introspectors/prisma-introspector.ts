/**
 * Prisma schema introspector - Stub for Phase 4
 *
 * This will analyze Prisma schema files and extract model/field information
 */

import type { IntrospectedSchema } from '../types.js'

export class PrismaIntrospector {
  /**
   * Introspect a Prisma schema file
   *
   * @param cwd - Current working directory
   * @param schemaPath - Path to schema.prisma relative to cwd
   * @returns Parsed schema information
   */
  async introspect(_cwd: string, _schemaPath: string): Promise<IntrospectedSchema> {
    // Stub - will be implemented in Phase 4
    throw new Error(
      'PrismaIntrospector not yet implemented. This will be available in Phase 4 of the migration system.',
    )
  }
}
