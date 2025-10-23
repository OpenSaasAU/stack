import { getContext } from '@opensaas/core'
import { PrismaClient } from '@/prisma/__generated__/prisma-client'
import config from '../opensaas.config'

export const prisma = new PrismaClient()

export async function getContextWithUser(userId: string) {
  return getContext(config, prisma, { userId })
}

export async function getAnonymousContext() {
  return getContext(config, prisma, null)
}
