/**
 * Demo: Using Virtual Fields with Type-Safe Selects and GetPayload
 *
 * This file demonstrates the solution to GitHub issue #305:
 * Virtual fields are now fully type-safe in select queries and GetPayload types!
 */

import type { UserSelect, UserGetPayload } from './.opensaas/types'

// ✅ SOLUTION 1: Use UserSelect for type-safe select objects
// This extends Prisma.UserSelect to include virtual fields
export const userDetailSelect = {
  id: true,
  name: true,
  email: true,
  displayName: true, // ✅ Virtual field - TypeScript knows about this!
} satisfies UserSelect

// ✅ SOLUTION 2: Use UserGetPayload to get the result type
// This properly types the result including the virtual field
export type UserDetail = UserGetPayload<{
  select: typeof userDetailSelect
}>

// UserDetail type will be:
// {
//   id: string
//   name: string
//   email: string
//   displayName: string  // ✅ Virtual field is included!
//   password: HashedPassword // Transformed field
// }

// ✅ SOLUTION 3: Selective virtual fields
// Only include virtual fields when they're selected
export const userBasicSelect = {
  id: true,
  name: true,
  // displayName NOT selected
} satisfies UserSelect

export type UserBasic = UserGetPayload<{
  select: typeof userBasicSelect
}>

// UserBasic type will be:
// {
//   id: string
//   name: string
//   // displayName is NOT included because it wasn't selected
// }

// ✅ SOLUTION 4: Using with context.db
// Virtual fields are automatically included in context.db return types
export async function exampleUsage() {
  // This is a demonstration - in real code, you would get context from getContext()
  // const context = await getContext()
  // Using the select object with context.db
  // const user = await context.db.user.findUnique({
  //   where: { id: '1' },
  //   select: userDetailSelect,
  // })
  // if (user) {
  //   // TypeScript knows about all these fields:
  //   console.log(user.id)
  //   console.log(user.name)
  //   console.log(user.email)
  //   console.log(user.displayName) // ✅ Virtual field is properly typed!
  // }
}

// BEFORE THIS FIX (GitHub Issue #305):
// ❌ TypeScript error: displayName doesn't exist in Prisma.UserSelect
// ❌ Prisma.UserGetPayload didn't include virtual fields

// AFTER THIS FIX:
// ✅ UserSelect extends Prisma.UserSelect with virtual fields
// ✅ UserGetPayload properly types virtual fields based on selection
// ✅ Full type safety for virtual fields!
