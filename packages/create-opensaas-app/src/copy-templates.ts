#!/usr/bin/env node
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const templatesDir = path.join(packageDir, 'templates')
const examplesDir = path.join(packageDir, '../../examples')

// Files/directories to exclude when copying
const excludePatterns = [
  'node_modules',
  '.next',
  '.turbo',
  '.opensaas',
  'prisma/schema.prisma',
  'dev.db',
  'tsconfig.tsbuildinfo',
  'next-env.d.ts',
  'pnpm-lock.yaml',
]

function shouldExclude(filePath: string): boolean {
  return excludePatterns.some((pattern) => filePath.includes(pattern))
}

async function copyTemplate(sourceName: string, targetName: string): Promise<void> {
  const source = path.join(examplesDir, sourceName)
  const target = path.join(templatesDir, targetName)

  console.log(`Copying ${sourceName} → templates/${targetName}...`)

  await fs.copy(source, target, {
    filter: (src) => {
      const shouldCopy = !shouldExclude(src)
      if (!shouldCopy) {
        console.log(`  Skipping: ${path.relative(source, src)}`)
      }
      return shouldCopy
    },
  })

  console.log(`✓ Copied ${sourceName}`)
}

async function main(): Promise<void> {
  console.log('📦 Copying templates from examples...\n')

  // Clean templates directory
  await fs.emptyDir(templatesDir)

  // Copy starter examples to templates
  await copyTemplate('starter', 'basic')
  await copyTemplate('starter-auth', 'with-auth')

  console.log('\n✅ Templates copied successfully!')
  console.log(`\nTemplates available:`)
  console.log(`  - basic (from examples/starter)`)
  console.log(`  - with-auth (from examples/starter-auth)`)
}

main().catch((err) => {
  console.error('❌ Failed to copy templates:', err)
  process.exit(1)
})
