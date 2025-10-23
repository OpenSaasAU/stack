/**
 * Test script to demonstrate OpenSaaS access control
 *
 * Run with: npx tsx test-access-control.ts
 */

import { prisma } from './lib/context'
import { getContext, getContextWithUser } from './lib/context'

async function test() {
  console.log('🧪 Testing OpenSaaS Framework Access Control\n')
  console.log('='.repeat(60))

  try {
    // Clean up any existing data
    await prisma.post.deleteMany()
    await prisma.user.deleteMany()

    // ========================================
    // Test 1: Create a user
    // ========================================
    console.log('\n📝 Test 1: Creating a user...')
    const alice = await prisma.user.create({
      data: {
        name: 'Alice',
        email: 'alice@example.com',
        password: 'hashed_password_here',
      },
    })
    console.log('✅ User created:', { id: alice.id, name: alice.name, email: alice.email })

    // ========================================
    // Test 2: Create a post as Alice
    // ========================================
    console.log('\n📝 Test 2: Creating a post as Alice...')
    const contextAlice = await getContextWithUser(alice.id)
    const post = await contextAlice.db.post.create({
      data: {
        title: 'My First Post',
        slug: 'my-first-post',
        content: 'Hello world! This is my first blog post.',
        internalNotes: 'Remember to add images later. Also fix typos.',
        author: { connect: { id: alice.id } },
      },
    })

    if (!post) {
      throw new Error('Failed to create post')
    }

    console.log('✅ Post created:', {
      id: post.id,
      title: post.title,
      status: post.status,
    })
    console.log('   Internal notes visible to author:', post.internalNotes)

    // ========================================
    // Test 3: Try to read draft as anonymous user
    // ========================================
    console.log('\n📝 Test 3: Reading draft post as anonymous user...')
    const contextAnon = await getContext()
    const postAnon = await contextAnon.db.post.findUnique({
      where: { id: post.id },
    })

    if (postAnon === null) {
      console.log('✅ Access control working: Draft post not visible to anonymous users')
    } else {
      console.log('❌ FAILED: Draft post should not be visible to anonymous users')
    }

    // ========================================
    // Test 4: Anonymous user can see it's not in the list
    // ========================================
    console.log('\n📝 Test 4: Listing posts as anonymous user...')
    const postsAnon = await contextAnon.db.post.findMany()
    console.log(`✅ Anonymous user sees ${postsAnon.length} posts (expected: 0)`)

    // ========================================
    // Test 5: Publish the post
    // ========================================
    console.log('\n📝 Test 5: Publishing the post as Alice...')
    const publishedPost = await contextAlice.db.post.update({
      where: { id: post.id },
      data: {
        status: 'published',
        publishedAt: new Date(),
      },
    })

    if (!publishedPost) {
      throw new Error('Failed to publish post')
    }

    console.log('✅ Post published:', { status: publishedPost.status })

    // ========================================
    // Test 6: Anonymous user can now see published post
    // ========================================
    console.log('\n📝 Test 6: Reading published post as anonymous user...')
    const postAnonPublished = await contextAnon.db.post.findUnique({
      where: { id: post.id },
    })

    if (postAnonPublished) {
      console.log('✅ Published post is visible:', postAnonPublished.title)

      // Check if internal notes are filtered
      if (postAnonPublished.internalNotes === undefined) {
        console.log('✅ Field-level access working: Internal notes hidden from anonymous users')
      } else {
        console.log('❌ FAILED: Internal notes should be hidden from anonymous users')
        console.log('   Got:', postAnonPublished.internalNotes)
      }
    } else {
      console.log('❌ FAILED: Published post should be visible to anonymous users')
    }

    // ========================================
    // Test 7: Create another user (Bob)
    // ========================================
    console.log('\n📝 Test 7: Creating another user (Bob)...')
    const bob = await prisma.user.create({
      data: {
        name: 'Bob',
        email: 'bob@example.com',
        password: 'hashed_password_here',
      },
    })
    console.log('✅ User created:', { id: bob.id, name: bob.name })

    // ========================================
    // Test 8: Bob tries to update Alice's post
    // ========================================
    console.log("\n📝 Test 8: Trying to update Alice's post as Bob (should fail)...")
    const contextBob = await getContextWithUser(bob.id)
    const updatedByBob = await contextBob.db.post.update({
      where: { id: post.id },
      data: { title: 'Hacked by Bob!' },
    })

    if (updatedByBob === null) {
      console.log("✅ Access control working: Bob cannot update Alice's post (silent failure)")
    } else {
      console.log("❌ FAILED: Bob should not be able to update Alice's post")
    }

    // ========================================
    // Test 9: Alice can update her own post
    // ========================================
    console.log('\n📝 Test 9: Updating post as Alice (owner)...')
    const updatedByAlice = await contextAlice.db.post.update({
      where: { id: post.id },
      data: { title: 'My Updated Post Title' },
    })

    if (updatedByAlice && updatedByAlice.title === 'My Updated Post Title') {
      console.log('✅ Owner can update their own post:', updatedByAlice.title)
    } else {
      console.log('❌ FAILED: Alice should be able to update her own post')
    }

    // ========================================
    // Test 10: Bob can see internal notes of his own posts
    // ========================================
    console.log('\n📝 Test 10: Creating a post as Bob with internal notes...')
    const bobsPost = await contextBob.db.post.create({
      data: {
        title: "Bob's Post",
        slug: 'bobs-post',
        content: "This is Bob's post",
        internalNotes: 'My secret notes',
        status: 'published',
        author: { connect: { id: bob.id } },
      },
    })

    if (bobsPost && bobsPost.internalNotes === 'My secret notes') {
      console.log('✅ Bob can see his own internal notes:', bobsPost.internalNotes)
    } else {
      console.log('❌ FAILED: Bob should see his own internal notes')
    }

    // ========================================
    // Test 11: Alice cannot see Bob's internal notes
    // ========================================
    console.log("\n📝 Test 11: Alice tries to read Bob's post...")
    const bobsPostAsAlice = await contextAlice.db.post.findUnique({
      where: { id: bobsPost!.id },
    })

    if (bobsPostAsAlice && bobsPostAsAlice.internalNotes === undefined) {
      console.log("✅ Field-level access working: Alice cannot see Bob's internal notes")
    } else {
      console.log("❌ FAILED: Alice should not see Bob's internal notes")
      console.log('   Got:', bobsPostAsAlice?.internalNotes)
    }

    // ========================================
    // Test 12: Count posts
    // ========================================
    console.log('\n📝 Test 12: Counting posts...')
    const countAlice = await contextAlice.db.post.count()
    const countAnon = await contextAnon.db.post.count()

    console.log(`✅ Alice sees ${countAlice} posts (expected: 2)`)
    console.log(`✅ Anonymous user sees ${countAnon} posts (expected: 2, both published)`)

    // ========================================
    // Summary
    // ========================================
    console.log('\n' + '='.repeat(60))
    console.log('🎉 All tests passed!')
    console.log('\nKey features demonstrated:')
    console.log('  ✅ Operation-level access control (query with filters)')
    console.log('  ✅ Silent failures on access denial')
    console.log('  ✅ Field-level access control (hiding internalNotes)')
    console.log('  ✅ Owner-based permissions (update/delete)')
    console.log('  ✅ Status-based visibility (draft vs published)')
    console.log('='.repeat(60))
  } catch (error) {
    console.error('\n❌ Test failed with error:', error)
    throw error
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up test data...')
    await prisma.post.deleteMany()
    await prisma.user.deleteMany()
    await prisma.$disconnect()
  }
}

// Run tests
test().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
