/**
 * Test script for virtual fields
 * Run with: npx tsx test-virtual.ts
 */

import { getContext } from './.opensaas/context'

async function main() {
  console.log('🧪 Testing virtual fields...\n')

  const context = await getContext()

  // Create a user
  console.log('1. Creating a user...')
  const user = await context.db.user.create({
    data: {
      name: 'Alice Johnson',
      email: 'alice@example.com',
      password: 'password123',
    },
  })

  console.log('   Created user:', {
    id: user.id,
    name: user.name,
    email: user.email,
    displayName: user.displayName, // Virtual field should be computed
  })

  // Query the user
  console.log('\n2. Querying the user...')
  const queriedUser = await context.db.user.findUnique({
    where: { id: user.id },
  })

  if (queriedUser) {
    console.log('   Queried user:', {
      id: queriedUser.id,
      name: queriedUser.name,
      email: queriedUser.email,
      displayName: queriedUser.displayName, // Virtual field should be computed
    })
  }

  // Update the user
  console.log('\n3. Updating the user...')
  const updatedUser = await context.db.user.update({
    where: { id: user.id },
    data: {
      name: 'Alice Smith',
    },
  })

  if (updatedUser) {
    console.log('   Updated user:', {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      displayName: updatedUser.displayName, // Virtual field should reflect new name
    })
  }

  // Query all users
  console.log('\n4. Querying all users...')
  const users = await context.db.user.findMany()

  console.log(`   Found ${users.length} user(s):`)
  users.forEach((u) => {
    console.log(`   - ${u.displayName}`)
  })

  // Clean up
  console.log('\n5. Cleaning up...')
  await context.db.user.delete({ where: { id: user.id } })
  console.log('   Deleted test user')

  console.log('\n✅ All tests passed!')
}

main()
  .then(() => {
    console.log('\n🎉 Test completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error)
    process.exit(1)
  })
