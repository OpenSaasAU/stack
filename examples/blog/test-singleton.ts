/**
 * Test script for singleton functionality
 * Run with: npx tsx test-singleton.ts
 */

import config from './opensaas.config.js'
import { getContext } from './.opensaas/context.js'

async function main() {
  console.log('🧪 Testing Singleton Functionality\n')

  // Get context
  const context = await getContext()

  try {
    // Test 1: Check that get() method exists
    console.log('✅ Test 1: Check get() method exists')
    if (typeof context.db.settings.get !== 'function') {
      throw new Error('get() method not found on singleton list')
    }
    console.log('   ✓ get() method exists on Settings list\n')

    // Test 2: Call get() - should auto-create with defaults
    console.log('✅ Test 2: Call get() - should auto-create with defaults')
    const settings = await context.db.settings.get()
    console.log('   Settings:', settings)
    if (!settings) {
      throw new Error('get() should have auto-created the record')
    }
    if (settings.siteName !== 'My Blog') {
      throw new Error(`Expected siteName='My Blog', got '${settings.siteName}'`)
    }
    if (settings.maintenanceMode !== false) {
      throw new Error(`Expected maintenanceMode=false, got ${settings.maintenanceMode}`)
    }
    if (settings.maxUploadSize !== 10) {
      throw new Error(`Expected maxUploadSize=10, got ${settings.maxUploadSize}`)
    }
    console.log('   ✓ Record auto-created with correct defaults\n')

    // Test 3: Try to create a second record - should fail
    console.log('✅ Test 3: Try to create a second record - should fail')
    try {
      // Singleton ids are now a bare `id Int @id` with no column default (see
      // ADR-0004), so Prisma's CreateInput requires `id`. The stack still injects
      // `id: 1` at runtime; this create is rejected by the singleton constraint
      // before reaching the database, so the supplied id is never used.
      await context.db.settings.create({
        data: { id: 2, siteName: 'Second Blog' },
      })
      throw new Error('Should have thrown an error when creating second record')
    } catch (error) {
      if (error instanceof Error && error.message.includes('singleton')) {
        console.log('   ✓ Correctly prevented creating second record')
        console.log(`   Error message: ${error.message}\n`)
      } else {
        throw error
      }
    }

    // Test 4: Update the singleton record
    console.log('✅ Test 4: Update the singleton record')
    const updated = await context.db.settings.update({
      where: { id: settings.id },
      data: { siteName: 'Updated Blog', maintenanceMode: true },
    })
    if (!updated) {
      throw new Error('Update should have succeeded')
    }
    if (updated.siteName !== 'Updated Blog') {
      throw new Error(`Expected siteName='Updated Blog', got '${updated.siteName}'`)
    }
    if (updated.maintenanceMode !== true) {
      throw new Error(`Expected maintenanceMode=true, got ${updated.maintenanceMode}`)
    }
    console.log('   ✓ Update succeeded')
    console.log('   Updated settings:', updated)
    console.log()

    // Test 5: Try to delete - should fail
    console.log('✅ Test 5: Try to delete - should fail')
    try {
      await context.db.settings.delete({ where: { id: settings.id } })
      throw new Error('Should have thrown an error when deleting singleton record')
    } catch (error) {
      if (error instanceof Error && error.message.includes('singleton')) {
        console.log('   ✓ Correctly prevented deleting singleton record')
        console.log(`   Error message: ${error.message}\n`)
      } else {
        throw error
      }
    }

    // Test 6: Try to use findMany - should fail
    console.log('✅ Test 6: Try to use findMany - should fail')
    try {
      await context.db.settings.findMany()
      throw new Error('Should have thrown an error when using findMany on singleton')
    } catch (error) {
      if (error instanceof Error && error.message.includes('findMany')) {
        console.log('   ✓ Correctly prevented using findMany')
        console.log(`   Error message: ${error.message}\n`)
      } else {
        throw error
      }
    }

    // Test 7: Verify get() returns the same (updated) record
    console.log('✅ Test 7: Verify get() returns the updated record')
    const settingsAgain = await context.db.settings.get()
    if (!settingsAgain) {
      throw new Error('get() should return the existing record')
    }
    if (settingsAgain.siteName !== 'Updated Blog') {
      throw new Error(`Expected siteName='Updated Blog', got '${settingsAgain.siteName}'`)
    }
    console.log('   ✓ get() returns the updated record')
    console.log('   Settings:', settingsAgain)
    console.log()

    console.log('🎉 All singleton tests passed!\n')
  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  }
}

main()
