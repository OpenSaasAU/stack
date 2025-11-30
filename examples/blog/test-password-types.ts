/**
 * Test that HashedPassword types are working correctly with Prisma extensions
 */
import { getContext } from './.opensaas/context'

async function test() {
  console.log('Testing HashedPassword type transformations...\n')

  // Get context as anonymous user
  const context = await getContext()

  // Create a user with a plain password (use random email to avoid conflicts)
  const user = await context.db.user.create({
    data: {
      name: 'Test User',
      email: `test-${Date.now()}@example.com`,
      password: 'plaintext_password', // Will be hashed via resolveInput hook
    },
  })

  console.log('✅ User created:', {
    id: user.id,
    name: user.name,
    email: user.email,
  })

  // The password field should be a HashedPassword instance (via Prisma extension)
  console.log('\n🔍 Checking password type...')
  console.log('Type of password:', typeof user.password)
  console.log('Password constructor:', user.password?.constructor?.name)
  console.log('Is HashedPassword instance:', user.password?.constructor?.name === 'HashedPassword')

  // HashedPassword should have compare method
  if (user.password && 'compare' in user.password && typeof user.password.compare === 'function') {
    console.log('\n✅ HashedPassword has compare method')

    // Test compare method
    const isValid = await user.password.compare('plaintext_password')
    console.log('Password matches original:', isValid)

    const isInvalid = await user.password.compare('wrong_password')
    console.log('Password does NOT match wrong:', !isInvalid)
  } else {
    console.log('\n❌ Password is not a HashedPassword instance!')
    console.log('Actual value:', user.password)
  }

  // Test query with virtual field
  console.log('\n🔍 Testing virtual field (displayName)...')
  const userWithVirtual = await context.db.user.findUnique({
    where: { id: user.id },
  })

  console.log('Display name:', userWithVirtual?.displayName)
  console.log('✅ Virtual field works:', !!userWithVirtual?.displayName)

  // Test with include
  console.log('\n🔍 Testing with include (posts relationship)...')
  const userWithPosts = await context.db.user.findUnique({
    where: { id: user.id },
    include: { posts: true },
  })

  console.log('✅ Include works:', Array.isArray(userWithPosts?.posts))
  console.log(
    'Password still HashedPassword:',
    userWithPosts?.password?.constructor?.name === 'HashedPassword',
  )

  // Cleanup
  console.log('\n🧹 Cleaning up...')
  await context.db.user.delete({ where: { id: user.id } })
  console.log('✅ Test complete!')
}

test()
  .catch((error) => {
    console.error('\n❌ Test failed:', error)
    process.exit(1)
  })
  .finally(() => {
    process.exit(0)
  })
