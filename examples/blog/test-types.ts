/**
 * Type safety test for virtual fields
 * This file demonstrates that virtual fields have strong typing
 */

import { getContext } from './.opensaas/context'
import type { User as _User } from './.opensaas/types'

async function testTypeSafety() {
  const context = await getContext()

  // Create a user
  const user = await context.db.user.create({
    data: {
      name: 'Test User',
      email: 'test@example.com',
      password: 'password',
      // Note: displayName is virtual and should not be in input
      // but CustomDB uses `any` for data type, so this won't cause a type error
    },
  })

  // Type assertion to verify displayName is strongly typed
  const displayName: string = user.displayName
  console.log('displayName is typed as string:', displayName)

  // This should work - displayName is a string
  const uppercaseName = user.displayName.toUpperCase()
  console.log('Can call string methods:', uppercaseName)

  // Clean up
  await context.db.user.delete({ where: { id: user.id } })

  console.log('✅ Type safety verified!')
}

testTypeSafety().catch(console.error)
