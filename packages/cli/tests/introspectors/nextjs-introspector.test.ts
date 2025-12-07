import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextjsIntrospector } from '../../src/migration/introspectors/nextjs-introspector.js'
import fs from 'fs-extra'
import path from 'path'
import os from 'os'

describe('NextjsIntrospector', () => {
  let introspector: NextjsIntrospector
  let tempDir: string

  beforeEach(async () => {
    introspector = new NextjsIntrospector()
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextjs-test-'))
  })

  afterEach(async () => {
    await fs.remove(tempDir)
  })

  it('should detect Next.js version', async () => {
    const pkg = {
      dependencies: {
        next: '^14.0.0',
      },
    }
    await fs.writeJSON(path.join(tempDir, 'package.json'), pkg)

    const result = await introspector.introspect(tempDir)

    expect(result.version).toBe('14.0.0')
  })

  it('should detect app router', async () => {
    const pkg = {
      dependencies: {
        next: '14.0.0',
      },
    }
    await fs.writeJSON(path.join(tempDir, 'package.json'), pkg)
    await fs.ensureDir(path.join(tempDir, 'app'))

    const result = await introspector.introspect(tempDir)

    expect(result.routerType).toBe('app')
  })

  it('should detect pages router', async () => {
    const pkg = {
      dependencies: {
        next: '14.0.0',
      },
    }
    await fs.writeJSON(path.join(tempDir, 'package.json'), pkg)
    await fs.ensureDir(path.join(tempDir, 'pages'))

    const result = await introspector.introspect(tempDir)

    expect(result.routerType).toBe('pages')
  })

  it('should detect both routers', async () => {
    const pkg = {
      dependencies: {
        next: '14.0.0',
      },
    }
    await fs.writeJSON(path.join(tempDir, 'package.json'), pkg)
    await fs.ensureDir(path.join(tempDir, 'app'))
    await fs.ensureDir(path.join(tempDir, 'pages'))

    const result = await introspector.introspect(tempDir)

    expect(result.routerType).toBe('both')
  })

  it('should detect TypeScript usage', async () => {
    const pkg = {
      dependencies: {
        next: '14.0.0',
      },
    }
    await fs.writeJSON(path.join(tempDir, 'package.json'), pkg)
    await fs.writeJSON(path.join(tempDir, 'tsconfig.json'), {
      compilerOptions: {
        target: 'es2015',
      },
    })

    const result = await introspector.introspect(tempDir)

    expect(result.typescript).toBe(true)
  })

  it('should detect auth libraries', async () => {
    const pkg = {
      dependencies: {
        next: '14.0.0',
        'next-auth': '^4.0.0',
      },
    }
    await fs.writeJSON(path.join(tempDir, 'package.json'), pkg)

    const result = await introspector.introspect(tempDir)

    expect(result.authLibrary).toBe('next-auth')
  })

  it('should detect better-auth', async () => {
    const pkg = {
      dependencies: {
        next: '14.0.0',
        'better-auth': '^1.0.0',
      },
    }
    await fs.writeJSON(path.join(tempDir, 'package.json'), pkg)

    const result = await introspector.introspect(tempDir)

    expect(result.authLibrary).toBe('better-auth')
  })

  it('should detect database libraries', async () => {
    const pkg = {
      dependencies: {
        next: '14.0.0',
        '@prisma/client': '^5.0.0',
      },
    }
    await fs.writeJSON(path.join(tempDir, 'package.json'), pkg)

    const result = await introspector.introspect(tempDir)

    expect(result.databaseLibrary).toBe('prisma')
    expect(result.hasPrisma).toBe(true)
  })

  it('should detect Prisma directory', async () => {
    const pkg = {
      dependencies: {
        next: '14.0.0',
      },
    }
    await fs.writeJSON(path.join(tempDir, 'package.json'), pkg)
    await fs.ensureDir(path.join(tempDir, 'prisma'))

    const result = await introspector.introspect(tempDir)

    expect(result.hasPrisma).toBe(true)
  })

  it('should detect .env file', async () => {
    const pkg = {
      dependencies: {
        next: '14.0.0',
      },
    }
    await fs.writeJSON(path.join(tempDir, 'package.json'), pkg)
    await fs.writeFile(path.join(tempDir, '.env'), 'DATABASE_URL=...')

    const result = await introspector.introspect(tempDir)

    expect(result.hasEnvFile).toBe(true)
  })

  it('should list all dependencies', async () => {
    const pkg = {
      dependencies: {
        next: '14.0.0',
        react: '18.0.0',
      },
      devDependencies: {
        typescript: '5.0.0',
      },
    }
    await fs.writeJSON(path.join(tempDir, 'package.json'), pkg)

    const result = await introspector.introspect(tempDir)

    expect(result.existingDependencies).toContain('next')
    expect(result.existingDependencies).toContain('react')
    expect(result.existingDependencies).toContain('typescript')
  })

  it('should generate recommendations for pages router', async () => {
    const pkg = {
      dependencies: {
        next: '14.0.0',
      },
    }
    await fs.writeJSON(path.join(tempDir, 'package.json'), pkg)
    await fs.ensureDir(path.join(tempDir, 'pages'))

    const result = await introspector.introspect(tempDir)
    const recommendations = introspector.getRecommendations(result)

    expect(recommendations.some(r => r.includes('App Router'))).toBe(true)
  })

  it('should recommend Better-auth for non-better-auth projects', async () => {
    const pkg = {
      dependencies: {
        next: '14.0.0',
        'next-auth': '4.0.0',
      },
    }
    await fs.writeJSON(path.join(tempDir, 'package.json'), pkg)

    const result = await introspector.introspect(tempDir)
    const recommendations = introspector.getRecommendations(result)

    expect(recommendations.some(r => r.includes('Better-auth'))).toBe(true)
  })

  it('should recommend Prisma setup if missing', async () => {
    const pkg = {
      dependencies: {
        next: '14.0.0',
      },
    }
    await fs.writeJSON(path.join(tempDir, 'package.json'), pkg)

    const result = await introspector.introspect(tempDir)
    const recommendations = introspector.getRecommendations(result)

    expect(recommendations.some(r => r.includes('Prisma'))).toBe(true)
  })

  it('should generate warnings for old Next.js versions', async () => {
    const pkg = {
      dependencies: {
        next: '12.0.0',
      },
    }
    await fs.writeJSON(path.join(tempDir, 'package.json'), pkg)

    const result = await introspector.introspect(tempDir)
    const warnings = introspector.getWarnings(result)

    expect(warnings.some(w => w.includes('12.0.0'))).toBe(true)
  })

  it('should warn about MongoDB/Mongoose', async () => {
    const pkg = {
      dependencies: {
        next: '14.0.0',
        mongoose: '7.0.0',
      },
    }
    await fs.writeJSON(path.join(tempDir, 'package.json'), pkg)

    const result = await introspector.introspect(tempDir)
    const warnings = introspector.getWarnings(result)

    expect(warnings.some(w => w.includes('MongoDB'))).toBe(true)
  })

  it('should throw for missing package.json', async () => {
    await expect(introspector.introspect(tempDir))
      .rejects.toThrow('package.json not found')
  })

  it('should detect router in src directory', async () => {
    const pkg = {
      dependencies: {
        next: '14.0.0',
      },
    }
    await fs.writeJSON(path.join(tempDir, 'package.json'), pkg)
    await fs.ensureDir(path.join(tempDir, 'src', 'app'))

    const result = await introspector.introspect(tempDir)

    expect(result.routerType).toBe('app')
  })

  it('should handle multiple auth libraries', async () => {
    const pkg = {
      dependencies: {
        next: '14.0.0',
        '@clerk/nextjs': '4.0.0',
      },
    }
    await fs.writeJSON(path.join(tempDir, 'package.json'), pkg)

    const result = await introspector.introspect(tempDir)

    expect(result.authLibrary).toBe('clerk')
  })

  it('should detect drizzle', async () => {
    const pkg = {
      dependencies: {
        next: '14.0.0',
        'drizzle-orm': '0.28.0',
      },
    }
    await fs.writeJSON(path.join(tempDir, 'package.json'), pkg)

    const result = await introspector.introspect(tempDir)

    expect(result.databaseLibrary).toBe('drizzle')
  })
})
