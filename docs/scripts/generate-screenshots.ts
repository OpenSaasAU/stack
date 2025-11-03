#!/usr/bin/env tsx
/**
 * Generate screenshots from the blog demo using Playwright MCP
 *
 * This script should be run with the blog demo running on http://localhost:3000
 *
 * Usage:
 *   1. Start blog demo: cd examples/blog && pnpm dev
 *   2. Run this script: cd docs && pnpm generate-screenshots
 */

import { writeFileSync } from 'fs'
import { join } from 'path'

const BLOG_URL = 'http://localhost:3000'
const SCREENSHOTS_DIR = join(process.cwd(), 'public', 'screenshots')

interface Screenshot {
  name: string
  description: string
  url: string
  selector?: string
}

const screenshots: Screenshot[] = [
  {
    name: 'home-page',
    description: 'Blog demo home page',
    url: BLOG_URL,
  },
  {
    name: 'admin-ui',
    description: 'Admin UI overview',
    url: `${BLOG_URL}/admin`,
  },
  {
    name: 'post-list',
    description: 'Post list table',
    url: `${BLOG_URL}/admin/post`,
  },
  {
    name: 'post-create',
    description: 'Create new post form',
    url: `${BLOG_URL}/admin/post/create`,
  },
]

async function generateScreenshots() {
  console.log('📸 Generating screenshots...')
  console.log(`Blog URL: ${BLOG_URL}`)
  console.log(`Output directory: ${SCREENSHOTS_DIR}`)
  console.log()

  for (const screenshot of screenshots) {
    console.log(`⏳ Capturing: ${screenshot.name}`)
    console.log(`   URL: ${screenshot.url}`)

    try {
      // TODO: Use Playwright MCP to take screenshot
      // For now, document the process
      console.log(`   ✅ Would capture ${screenshot.name}.png`)
      console.log(`   Description: ${screenshot.description}`)

      // Create a placeholder file
      const placeholderPath = join(SCREENSHOTS_DIR, `${screenshot.name}.txt`)
      writeFileSync(
        placeholderPath,
        `Screenshot: ${screenshot.name}\nURL: ${screenshot.url}\nDescription: ${screenshot.description}\n`,
      )
    } catch (error) {
      console.error(`   ❌ Failed to capture ${screenshot.name}:`, error)
    }
    console.log()
  }

  console.log('✨ Screenshot generation complete!')
  console.log()
  console.log('📝 Note: To actually capture screenshots, you need to:')
  console.log('   1. Have Playwright MCP server running')
  console.log('   2. Call mcp__playwright__screenshot with the URL')
  console.log('   3. Save the returned base64 image data')
}

generateScreenshots().catch(console.error)
