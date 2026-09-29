'use server'

import { getContext } from '@/.opensaas/context'
import { getSession } from '@/lib/auth'
import type { UserCreateInput } from '../../.opensaas/types'

async function sessionContext() {
  const session = await getSession()
  return session ? getContext(session) : getContext()
}

/**
 * Create a new user (sign up)
 */
export async function createUser(data: UserCreateInput) {
  const context = await getContext()

  const user = await context.db.User.create({
    data,
  })

  if (!user) {
    return { success: false, error: 'Failed to create user' }
  }

  return { success: true, user }
}

/**
 * Get a user by ID: `null` is not-found or denied
 */
export async function getUser(userId: string) {
  const context = await sessionContext()

  return context.db.User.where({ id: { equals: userId } }).first()
}

/**
 * Update the signed-in user's own record
 */
export async function updateUser(data: { name?: string; email?: string }) {
  const session = await getSession()
  if (!session) return { success: false, error: 'User not found or access denied' }
  const context = await getContext(session)

  const user = await context.db.User.update({
    where: { id: session.userId },
    data,
  })

  if (!user) {
    return { success: false, error: 'User not found or access denied' }
  }

  return { success: true, user }
}
