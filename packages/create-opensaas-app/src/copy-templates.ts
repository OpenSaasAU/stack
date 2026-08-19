#!/usr/bin/env node
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'
import { replaceWorkspaceVersions } from './lib/package-json.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const templatesDir = path.join(packageDir, 'templates')
const examplesDir = path.join(packageDir, '../../examples')
const corePackageJsonPath = path.join(packageDir, '../core/package.json')

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

async function updatePackageJsonVersions(
  packageJsonPath: string,
  stackVersion: string,
): Promise<void> {
  const packageJson = await fs.readJSON(packageJsonPath)
  const updated = replaceWorkspaceVersions(packageJson, stackVersion)
  await fs.writeJSON(packageJsonPath, updated, { spaces: 2 })
}

async function copyTemplate(
  sourceName: string,
  targetName: string,
  stackVersion: string,
): Promise<void> {
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

  const packageJsonPath = path.join(target, 'package.json')
  if (await fs.pathExists(packageJsonPath)) {
    await updatePackageJsonVersions(packageJsonPath, stackVersion)
    console.log(`  Updated package.json versions to ^${stackVersion}`)
  }

  console.log(`✓ Copied ${sourceName}`)
}

async function main(): Promise<void> {
  console.log('📦 Copying templates from examples...\n')

  const corePackageJson = await fs.readJSON(corePackageJsonPath)
  const stackVersion = corePackageJson.version

  if (!stackVersion) {
    console.error('❌ Failed to read version from @opensaas/stack-core package.json')
    process.exit(1)
  }

  console.log(`Using stack version: ${stackVersion}\n`)

  await fs.emptyDir(templatesDir)

  await copyTemplate('starter', 'basic', stackVersion)
  await copyTemplate('starter-auth', 'with-auth', stackVersion)

  console.log('\n✅ Templates copied successfully!')
  console.log(`\nTemplates available:`)
  console.log(`  - basic (from examples/starter)`)
  console.log(`  - with-auth (from examples/starter-auth)`)
}

main().catch((err) => {
  console.error('❌ Failed to copy templates:', err)
  process.exit(1)
})
