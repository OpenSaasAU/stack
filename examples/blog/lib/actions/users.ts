'use server'

import { getContext } from '@/.opensaas/context'
import type { UserCreateInput } from '../../.opensaas/types'

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
  const context = await getContext()

  return context.db.User.where({ id: { equals: userId } }).first()
}

/**
 * Update a user
 * Only the user themselves can update their own record
 */
export async function updateUser(userId: string, data: { name?: string; email?: string }) {
  const context = await getContext({ userId })

  const user = await context.db.User.update({
    where: { id: userId },
    data,
  })

  if (!user) {
    return { success: false, error: 'User not found or access denied' }
  }

  return { success: true, user }
}
