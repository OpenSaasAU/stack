/**
 * Type checking test file
 * This file tests that virtual field hooks receive properly typed item parameters
 */

import { list } from '@opensaas/stack-core'
import { virtual } from '@opensaas/stack-core/fields'
import type { Lists } from './.opensaas/lists'

// Test 1: Virtual field hook should have properly typed item parameter
const testUser = list<Lists.User.TypeInfo>({
  fields: {
    displayName: virtual({
      type: 'string',
      hooks: {
        resolveOutput: ({ item }) => {
          // Hover over 'item' here - it should show type User (with name, email, etc.)
          // NOT 'any'!

          // If typing is working correctly, these should be typed as:
          // - item.name: string
          // - item.email: string
          const _name: string = item.name
          const _email: string = item.email

          return `${item.name} (${item.email})`
        },
      },
    }),
  },
})

export { testUser }
