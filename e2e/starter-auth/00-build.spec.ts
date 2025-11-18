import { test, expect } from '@playwright/test'
import { execSync } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

const exampleDir = path.join(process.cwd(), 'examples/starter-auth')

test.describe('Build Validation', () => {
  test('should build the project successfully', async () => {
    test.setTimeout(300000) // 5 minutes for build

    // Clean previous build
    console.log('Cleaning previous build...')
    try {
      execSync('pnpm clean', {
        cwd: exampleDir,
        stdio: 'inherit',
      })
    } catch {
      console.log('Clean failed (this is ok if no previous build exists)')
    }

    // Build the project
    console.log('Building project...')
    let buildOutput = ''
    try {
      buildOutput = execSync('pnpm build', {
        cwd: exampleDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      })
      console.log(buildOutput)
    } catch (error: unknown) {
      const err = error as { stdout?: string; message?: string }
      console.error('Build failed:', err.stdout || err.message)
      throw error
    }

    // Verify build output exists
    const nextBuildDir = path.join(exampleDir, '.next')
    expect(fs.existsSync(nextBuildDir)).toBe(true)

    // Verify no build errors
    expect(buildOutput).not.toContain('Failed to compile')
    expect(buildOutput).not.toContain('ERROR')

    console.log('Build completed successfully!')
  })

  test('should generate schema and types successfully', async () => {
    test.setTimeout(120000) // 2 minutes

    console.log('Generating schema and types...')
    let generateOutput = ''
    try {
      generateOutput = execSync('pnpm generate', {
        cwd: exampleDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      })
      console.log(generateOutput)
    } catch (error: unknown) {
      const err = error as { stdout?: string; message?: string }
      console.error('Generate failed:', err.stdout || err.message)
      throw error
    }

    // Verify generated files exist
    const prismaSchemaPath = path.join(exampleDir, 'prisma/schema.prisma')
    const typesPath = path.join(exampleDir, '.opensaas/types.ts')
    const contextPath = path.join(exampleDir, '.opensaas/context.ts')

    expect(fs.existsSync(prismaSchemaPath)).toBe(true)
    expect(fs.existsSync(typesPath)).toBe(true)
    expect(fs.existsSync(contextPath)).toBe(true)

    console.log('Generation completed successfully!')
  })

  test('should have no TypeScript errors', async () => {
    test.setTimeout(120000) // 2 minutes

    console.log('Checking TypeScript...')
    try {
      // Run TypeScript compiler in check mode
      execSync('npx tsc --noEmit', {
        cwd: exampleDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      })
      console.log('TypeScript check passed!')
    } catch (error: unknown) {
      const err = error as { stdout?: string; message?: string }
      console.error('TypeScript errors:', err.stdout || err.message)
      throw new Error(`TypeScript compilation failed:\n${err.stdout || err.message}`)
    }
  })

  test('should have all required dependencies installed', async () => {
    const nodeModulesPath = path.join(exampleDir, 'node_modules')
    expect(fs.existsSync(nodeModulesPath)).toBe(true)

    // Check for critical dependencies
    const criticalDeps = [
      '@opensaas/stack-core',
      '@opensaas/stack-auth',
      '@opensaas/stack-ui',
      'next',
      'react',
      'better-auth',
      '@prisma/client',
    ]

    for (const dep of criticalDeps) {
      const depPath = path.join(nodeModulesPath, dep)
      expect(fs.existsSync(depPath)).toBe(true)
    }
  })

  test('should have valid environment configuration', async () => {
    const envExamplePath = path.join(exampleDir, '.env.example')

    // .env.example should exist
    expect(fs.existsSync(envExamplePath)).toBe(true)

    const envExample = fs.readFileSync(envExamplePath, 'utf-8')

    // Should have required env vars defined
    expect(envExample).toContain('DATABASE_URL')
    expect(envExample).toContain('BETTER_AUTH_SECRET')
    expect(envExample).toContain('BETTER_AUTH_URL')
  })

  test('should have valid Next.js configuration', async () => {
    const nextConfigPath = path.join(exampleDir, 'next.config.js')

    expect(fs.existsSync(nextConfigPath)).toBe(true)

    // File should contain valid Next.js config
    const configContent = fs.readFileSync(nextConfigPath, 'utf-8')
    expect(configContent).toContain('module.exports')
  })

  test('should have valid opensaas.config.ts', async () => {
    const configPath = path.join(exampleDir, 'opensaas.config.ts')

    expect(fs.existsSync(configPath)).toBe(true)

    // File should contain config export
    const configContent = fs.readFileSync(configPath, 'utf-8')
    expect(configContent).toContain('export default config')
    expect(configContent).toContain('authPlugin')
    expect(configContent).toContain('lists')
  })
})
