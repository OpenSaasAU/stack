/**
 * Test nested virtual fields in relationships
 * This demonstrates that virtual fields on related models now work correctly
 */

import type { PostSelect } from './.opensaas/types'

// Test 1: Select virtual field on nested relationship
// This should NOT produce a type error anymore!
export const postSelectWithNestedVirtual = {
  id: true,
  title: true,
  author: {
    select: {
      id: true,
      name: true,
      email: true,
      displayName: true, // Virtual field on User - should work now!
    },
  },
} satisfies PostSelect

// Test 2: UserSelect with virtual field works
import type { UserSelect } from './.opensaas/types'

export const userSelectWithVirtual = {
  id: true,
  name: true,
  email: true,
  displayName: true, // Virtual field - works!
} satisfies UserSelect

// Test 3: Multiple levels of nesting
export const postSelectDeepNested = {
  id: true,
  title: true,
  author: {
    select: {
      id: true,
      displayName: true, // Virtual field
      posts: {
        select: {
          id: true,
          title: true,
        },
      },
    },
  },
} satisfies PostSelect

console.log('✅ All type checks passed for nested virtual fields!')
console.log('The fix successfully allows virtual fields in nested relationship selections.')
