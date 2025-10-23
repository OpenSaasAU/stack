import { getContext as getOpensaasContext } from '@opensaas/core'
import { PrismaClient } from '@/prisma/__generated__/prisma-client'
import config from '../opensaas.config'

// Create Prisma client singleton
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function getContext() {
  return await getOpensaasContext<typeof prisma>(config, prisma, null)
}

export async function getContextWithUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  return await getOpensaasContext<typeof prisma>(config, prisma, user)
}
