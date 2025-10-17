import { getContext } from "@opensaas/core";
import type { OpenSaaSConfig } from "@opensaas/core";
import type { AdminContext } from "./types.js";

/**
 * Get admin context for server components
 *
 * This function must be called from a server component or server action.
 * It creates an access-controlled context based on the current user session.
 *
 * @param config - OpenSaaS configuration
 * @param prisma - Prisma client instance
 * @returns Admin context with access-controlled database operations
 *
 * @example
 * ```tsx
 * // In a server component
 * import { getAdminContext } from '@opensaas/ui/server'
 * import { PrismaClient } from '@prisma/client'
 * import config from '@/opensaas.config'
 *
 * const prisma = new PrismaClient()
 *
 * export default async function Page() {
 *   const adminContext = await getAdminContext(config, prisma)
 *   return <AdminUI context={adminContext} />
 * }
 * ```
 */
export async function getAdminContext(
  config: OpenSaaSConfig,
  prisma: any,
): Promise<AdminContext> {
  // Get current session using config's session handler
  const session = config.session ? await config.session.getSession() : null;

  // Create access-controlled context
  const context = await getContext(config, prisma, session);

  return {
    context,
    config,
    session,
    prisma,
  };
}
