import path from 'path'
import fs from 'fs-extra'

export interface NextjsAnalysis {
  version: string
  routerType: 'app' | 'pages' | 'both' | 'unknown'
  typescript: boolean
  authLibrary?: string
  databaseLibrary?: string
  hasPrisma: boolean
  hasEnvFile: boolean
  existingDependencies: string[]
}

export class NextjsIntrospector {
  async introspect(cwd: string): Promise<NextjsAnalysis> {
    const packageJsonPath = path.join(cwd, 'package.json')

    if (!(await fs.pathExists(packageJsonPath))) {
      throw new Error('package.json not found')
    }

    const pkg = await fs.readJSON(packageJsonPath)

    const analysis: NextjsAnalysis = {
      version: this.getNextVersion(pkg),
      routerType: await this.detectRouterType(cwd),
      typescript: await this.hasTypeScript(cwd),
      hasPrisma:
        this.hasDependency(pkg, '@prisma/client') ||
        (await fs.pathExists(path.join(cwd, 'prisma'))),
      hasEnvFile:
        (await fs.pathExists(path.join(cwd, '.env'))) ||
        (await fs.pathExists(path.join(cwd, '.env.local'))),
      existingDependencies: this.getAllDependencies(pkg),
    }

    analysis.authLibrary = this.detectAuthLibrary(pkg)
    analysis.databaseLibrary = this.detectDatabaseLibrary(pkg)

    return analysis
  }

  private getNextVersion(pkg: Record<string, unknown>): string {
    const deps = pkg.dependencies as Record<string, string> | undefined
    const devDeps = pkg.devDependencies as Record<string, string> | undefined
    const version = deps?.next || devDeps?.next || 'unknown'
    return version.replace(/^[\^~]/, '')
  }

  private async detectRouterType(cwd: string): Promise<'app' | 'pages' | 'both' | 'unknown'> {
    const hasApp =
      (await fs.pathExists(path.join(cwd, 'app'))) ||
      (await fs.pathExists(path.join(cwd, 'src', 'app')))
    const hasPages =
      (await fs.pathExists(path.join(cwd, 'pages'))) ||
      (await fs.pathExists(path.join(cwd, 'src', 'pages')))

    if (hasApp && hasPages) return 'both'
    if (hasApp) return 'app'
    if (hasPages) return 'pages'
    return 'unknown'
  }

  private async hasTypeScript(cwd: string): Promise<boolean> {
    return await fs.pathExists(path.join(cwd, 'tsconfig.json'))
  }

  private hasDependency(pkg: Record<string, unknown>, name: string): boolean {
    const deps = pkg.dependencies as Record<string, string> | undefined
    const devDeps = pkg.devDependencies as Record<string, string> | undefined
    return !!(deps?.[name] || devDeps?.[name])
  }

  private getAllDependencies(pkg: Record<string, unknown>): string[] {
    const deps = pkg.dependencies as Record<string, string> | undefined
    const devDeps = pkg.devDependencies as Record<string, string> | undefined
    return [...Object.keys(deps || {}), ...Object.keys(devDeps || {})]
  }

  private detectAuthLibrary(pkg: Record<string, unknown>): string | undefined {
    const authLibraries = [
      { name: 'next-auth', dep: 'next-auth' },
      { name: 'better-auth', dep: 'better-auth' },
      { name: 'clerk', dep: '@clerk/nextjs' },
      { name: 'auth0', dep: '@auth0/nextjs-auth0' },
      { name: 'supabase', dep: '@supabase/auth-helpers-nextjs' },
      { name: 'lucia', dep: 'lucia' },
      { name: 'kinde', dep: '@kinde-oss/kinde-auth-nextjs' },
    ]

    for (const lib of authLibraries) {
      if (this.hasDependency(pkg, lib.dep)) {
        return lib.name
      }
    }

    return undefined
  }

  private detectDatabaseLibrary(pkg: Record<string, unknown>): string | undefined {
    const dbLibraries = [
      { name: 'prisma', dep: '@prisma/client' },
      { name: 'drizzle', dep: 'drizzle-orm' },
      { name: 'typeorm', dep: 'typeorm' },
      { name: 'mongoose', dep: 'mongoose' },
      { name: 'knex', dep: 'knex' },
      { name: 'sequelize', dep: 'sequelize' },
      { name: 'kysely', dep: 'kysely' },
    ]

    for (const lib of dbLibraries) {
      if (this.hasDependency(pkg, lib.dep)) {
        return lib.name
      }
    }

    return undefined
  }

  getRecommendations(analysis: NextjsAnalysis): string[] {
    const recommendations: string[] = []

    if (analysis.routerType === 'pages') {
      recommendations.push('Consider migrating to App Router for best OpenSaaS Stack integration')
    }

    if (analysis.authLibrary && analysis.authLibrary !== 'better-auth') {
      recommendations.push(
        `Consider migrating from ${analysis.authLibrary} to Better-auth (used by OpenSaaS Stack auth plugin)`,
      )
    }

    if (!analysis.hasPrisma) {
      recommendations.push("OpenSaaS Stack uses Prisma - you'll need to set up your data models")
    }

    if (analysis.databaseLibrary && analysis.databaseLibrary !== 'prisma') {
      recommendations.push(
        `You're using ${analysis.databaseLibrary} - you may need to migrate to Prisma or run both`,
      )
    }

    if (!analysis.hasEnvFile) {
      recommendations.push('Create a .env file with DATABASE_URL for your database connection')
    }

    return recommendations
  }

  getWarnings(analysis: NextjsAnalysis): string[] {
    const warnings: string[] = []

    if (analysis.version.startsWith('12') || analysis.version.startsWith('11')) {
      warnings.push(
        `Next.js ${analysis.version} is quite old - consider upgrading to 14+ for best results`,
      )
    }

    if (analysis.databaseLibrary === 'mongoose') {
      warnings.push(
        'MongoDB/Mongoose is not fully supported by Prisma - migration may require database change',
      )
    }

    return warnings
  }
}
