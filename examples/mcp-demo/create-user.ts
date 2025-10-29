/**
 * Script to create a new user with email and password
 * Run with: npx tsx create-user.ts
 */

import { auth } from './lib/auth'

async function createUser() {
  const email = process.argv[2] || 'admin@example.com'
  const password = process.argv[3] || 'password123'
  const name = process.argv[4] || 'Admin User'

  console.log('Creating user...')
  console.log(`Email: ${email}`)
  console.log(`Password: ${password}`)
  console.log(`Name: ${name}`)

  try {
    // Create user using Better Auth
    const result = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name,
      },
    })

    if (result) {
      console.log('\n✅ User created successfully!')
      console.log('User ID:', result.user.id)
      console.log('Email:', result.user.email)
      console.log('Name:', result.user.name)
      console.log('\nYou can now sign in at /sign-in')
    } else {
      console.error('\n❌ Failed to create user')
    }
  } catch (error) {
    console.error('\n❌ Error creating user:', error)
    if (error instanceof Error) {
      console.error('Message:', error.message)
    }
  }
}

createUser()
