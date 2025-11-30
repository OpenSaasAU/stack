/**
 * Test Prisma extensions directly without context wrapper
 */
import { PrismaClient } from './.opensaas/prisma-client/client'
import { prismaExtensions } from './.opensaas/prisma-extensions'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

async function test() {
  console.log('Testing Prisma extensions directly...\n')

  // Create base Prisma client
  const adapter = new PrismaBetterSqlite3({ url: 'file:./dev.db' })
  const basePrisma = new PrismaClient({ adapter })

  // Apply extensions
  const prisma = basePrisma.$extends(prismaExtensions)

  // Create a user
  const user = await prisma.user.create({
    data: {
      name: 'Direct Test User',
      email: `direct-${Date.now()}@example.com`,
      password: '$2b$10$testhashedpassword', // Pre-hashed format
    },
  })

  console.log('✅ User created:', {
    id: user.id,
    name: user.name,
  })

  console.log('\n🔍 Checking password type...')
  console.log('Type of password:', typeof user.password)
  console.log('Password constructor:', user.password?.constructor?.name)
  console.log('Is HashedPassword instance:', user.password?.constructor?.name === 'HashedPassword')
  console.log('Has compare method:', user.password && 'compare' in user.password)

  // Cleanup
  await prisma.user.delete({ where: { id: user.id } })

  await prisma.$disconnect()
  console.log('\n✅ Test complete!')
}

test().catch((error) => {
  console.error('\n❌ Test failed:', error)
  process.exit(1)
})
