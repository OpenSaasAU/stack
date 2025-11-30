/**
 * Test virtual fields directly with Prisma extensions (bypassing context)
 */
import { PrismaClient } from './.opensaas/prisma-client/client'
import { prismaExtensions } from './.opensaas/prisma-extensions'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

async function test() {
  console.log('Testing virtual fields with Prisma extensions directly...\n')

  // Create extended Prisma client
  const adapter = new PrismaBetterSqlite3({ url: 'file:./dev.db' })
  const basePrisma = new PrismaClient({ adapter })
  const prisma = basePrisma.$extends(prismaExtensions)

  // Create a user
  const user = await prisma.user.create({
    data: {
      name: 'Virtual Test User',
      email: `virtual-${Date.now()}@example.com`,
      password: '$2b$10$testhashedpassword',
    },
  })

  console.log('✅ User created:', {
    id: user.id,
    name: user.name,
    email: user.email,
  })

  console.log('\n🔍 Checking virtual field (displayName)...')
  console.log('Display name:', user.displayName)
  console.log('Expected format:', `${user.name} (${user.email})`)
  console.log('Match:', user.displayName === `${user.name} (${user.email})`)

  // Query the user
  const queriedUser = await prisma.user.findUnique({
    where: { id: user.id },
  })

  console.log('\n🔍 Checking queried user...')
  console.log('Display name:', queriedUser?.displayName)
  console.log('Match:', queriedUser?.displayName === `${queriedUser?.name} (${queriedUser?.email})`)

  // Update and check virtual field updates
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: { name: 'Updated Name' },
  })

  console.log('\n🔍 Checking updated user...')
  console.log('Display name:', updatedUser.displayName)
  console.log('Expected:', 'Updated Name (' + user.email + ')')
  console.log('Match:', updatedUser.displayName === `Updated Name (${user.email})`)

  // Cleanup
  await prisma.user.delete({ where: { id: user.id } })
  await prisma.$disconnect()

  console.log('\n✅ Test complete!')
}

test().catch((error) => {
  console.error('\n❌ Test failed:', error)
  process.exit(1)
})
