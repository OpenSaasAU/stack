import { AdminUI } from "@opensaas/ui";
import { getAdminContext } from "@opensaas/ui/server";
import type { ServerActionInput } from "@opensaas/ui/server";
import { getContext } from "@opensaas/core";
import { PrismaClient } from "@prisma/client";
import config from "../../../opensaas.config";

// Create Prisma client singleton
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// User-defined wrapper function for server actions
async function serverAction(props: ServerActionInput) {
  "use server";
  const session = config.session ? await config.session.getSession() : null;
  const context = await getContext(config, prisma, session);
  return await context.serverAction(props);
}

interface AdminPageProps {
  params: Promise<{ admin?: string[] }>;
}

/**
 * Main admin interface using catch-all route
 * Handles all admin routes: /admin, /admin/Post, /admin/Post/create, /admin/Post/[id]
 */
export default async function AdminPage({ params }: AdminPageProps) {
  const resolvedParams = await params;
  const adminContext = await getAdminContext(config, prisma);

  return (
    <AdminUI
      context={adminContext}
      params={resolvedParams.admin}
      basePath="/admin"
      serverAction={serverAction}
    />
  );
}
