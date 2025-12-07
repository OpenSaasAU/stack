/**
 * Migration Config Generator
 *
 * Generates opensaas.config.ts from migration session data.
 */

import type {
  MigrationSession,
  MigrationOutput,
  IntrospectedSchema,
  IntrospectedModel,
  IntrospectedField,
} from '../types.js'
import { PrismaIntrospector } from '../introspectors/prisma-introspector.js'
import { KeystoneIntrospector } from '../introspectors/keystone-introspector.js'

export class MigrationGenerator {
  private prismaIntrospector: PrismaIntrospector
  private keystoneIntrospector: KeystoneIntrospector

  constructor() {
    this.prismaIntrospector = new PrismaIntrospector()
    this.keystoneIntrospector = new KeystoneIntrospector()
  }

  /**
   * Generate migration output from session
   */
  async generate(session: MigrationSession): Promise<MigrationOutput> {
    const { projectType, analysis, answers } = session

    // Get full schema if available
    let schema: IntrospectedSchema | undefined
    try {
      if (projectType === 'prisma') {
        schema = await this.prismaIntrospector.introspect(analysis.cwd)
      } else if (projectType === 'keystone') {
        schema = await this.keystoneIntrospector.introspect(analysis.cwd)
      }
    } catch {
      // Continue without schema - will generate example config
    }

    // Collect used field types for imports
    const usedFieldTypes = new Set<string>(['text']) // Always need text
    const warnings: string[] = []

    // Generate lists
    const lists = this.generateLists(schema, answers, usedFieldTypes, warnings)

    // Generate access control helpers
    const accessHelpers = this.generateAccessHelpers(answers)

    // Generate database config
    const dbConfig = this.generateDatabaseConfig(
      (answers.db_provider as string) || analysis.provider || 'sqlite',
    )

    // Determine if using auth
    const useAuth = answers.enable_auth === true

    // Generate imports
    const imports = this.generateImports(usedFieldTypes, useAuth, dbConfig.provider)

    // Generate the full config
    const configContent = this.assembleConfig({
      imports,
      accessHelpers,
      dbConfig,
      lists,
      useAuth,
      authMethods: (answers.auth_methods as string[]) || ['email-password'],
      adminBasePath: (answers.admin_base_path as string) || '/admin',
    })

    // Generate dependencies list
    const dependencies = this.generateDependencies(dbConfig.provider, useAuth)

    // Generate additional files
    const files = this.generateAdditionalFiles(answers, dbConfig.provider)

    // Generate next steps
    const steps = this.generateSteps(useAuth, dbConfig.provider)

    // Add warnings from introspection
    if (schema) {
      const introspectorWarnings =
        projectType === 'prisma'
          ? this.prismaIntrospector.getWarnings(schema)
          : this.keystoneIntrospector.getWarnings(schema)
      warnings.push(...introspectorWarnings)
    }

    return {
      configContent,
      dependencies,
      files,
      steps,
      warnings,
    }
  }

  /**
   * Generate list definitions from schema
   */
  private generateLists(
    schema: IntrospectedSchema | undefined,
    answers: Record<string, unknown>,
    usedFieldTypes: Set<string>,
    warnings: string[],
  ): string {
    if (!schema || schema.models.length === 0) {
      // No schema, generate example lists
      usedFieldTypes.add('timestamp')
      return `    // Add your lists here
    // Example:
    // Post: list({
    //   fields: {
    //     title: text({ validation: { isRequired: true } }),
    //     content: text(),
    //     createdAt: timestamp({ defaultValue: { kind: 'now' } }),
    //   },
    // }),`
    }

    // Filter out auth models if using auth plugin
    const skipAuthModels = answers.skip_auth_models === true
    const authModelNames = ['User', 'Account', 'Session', 'Verification']

    const modelsToGenerate = schema.models.filter((model) => {
      if (skipAuthModels && authModelNames.includes(model.name)) {
        return false
      }
      return true
    })

    // Get models that should have owner access
    const ownerModels = new Set((answers.models_with_owner as string[]) || [])

    // Generate each list
    const listDefinitions = modelsToGenerate.map((model) => {
      return this.generateList(model, schema, ownerModels.has(model.name), answers, usedFieldTypes, warnings)
    })

    return listDefinitions.join('\n')
  }

  /**
   * Generate a single list definition
   */
  private generateList(
    model: IntrospectedModel,
    schema: IntrospectedSchema,
    hasOwnerAccess: boolean,
    answers: Record<string, unknown>,
    usedFieldTypes: Set<string>,
    warnings: string[],
  ): string {
    const fields: string[] = []

    // Skip system fields (id, createdAt, updatedAt) - OpenSaaS adds these automatically
    const systemFields = ['id', 'createdAt', 'updatedAt']

    for (const field of model.fields) {
      if (systemFields.includes(field.name)) continue
      if (field.isId) continue // Skip ID fields

      const fieldDef = this.generateField(field, schema, usedFieldTypes, warnings)
      if (fieldDef) {
        fields.push(`        ${field.name}: ${fieldDef},`)
      }
    }

    // Generate access control
    const access = this.generateListAccess(hasOwnerAccess, model, answers)

    const fieldsBlock = fields.length > 0 ? `\n${fields.join('\n')}\n      ` : ''

    return `    ${model.name}: list({
      fields: {${fieldsBlock}},${access}
    }),`
  }

  /**
   * Generate a field definition
   */
  private generateField(
    field: IntrospectedField,
    schema: IntrospectedSchema,
    usedFieldTypes: Set<string>,
    warnings: string[],
  ): string | null {
    // Handle relationships
    if (field.relation) {
      usedFieldTypes.add('relationship')

      // Find the related model and back-reference field
      const relatedModel = schema.models.find((m) => m.name === field.relation!.model)
      const backRef = relatedModel?.fields.find(
        (f) => f.relation && f.relation.model === field.type,
      )

      const ref = backRef ? `${field.relation.model}.${backRef.name}` : field.relation.model

      const many = field.isList ? ', many: true' : ''
      return `relationship({ ref: '${ref}'${many} })`
    }

    // Handle enums as select fields
    const enumDef = schema.enums.find((e) => e.name === field.type)
    if (enumDef) {
      usedFieldTypes.add('select')
      const enumOptions = enumDef.values.map((v) => `{ label: '${v}', value: '${v}' }`).join(', ')

      let selectOptions = `options: [${enumOptions}]`
      if (field.defaultValue) {
        const defaultVal = field.defaultValue.replace(/^["']|["']$/g, '')
        selectOptions += `, defaultValue: '${defaultVal}'`
      }
      return `select({ ${selectOptions} })`
    }

    // Map Prisma/Keystone types to OpenSaaS
    const mapping = this.prismaIntrospector.mapPrismaTypeToOpenSaas(field.type)
    usedFieldTypes.add(mapping.import)

    // Build options
    const options: string[] = []

    if (field.isRequired && !field.defaultValue) {
      options.push('validation: { isRequired: true }')
    }

    if (field.isUnique) {
      options.push("isIndexed: 'unique'")
    }

    // Handle default values
    if (field.defaultValue) {
      if (field.type === 'DateTime' && field.defaultValue === 'now()') {
        options.push("defaultValue: { kind: 'now' }")
      } else if (field.type === 'Boolean') {
        options.push(`defaultValue: ${field.defaultValue}`)
      }
      // Other defaults are harder to map automatically
    }

    // Generate unsupported type warning
    if (['BigInt', 'Decimal', 'Bytes'].includes(field.type)) {
      warnings.push(
        `Field "${field.name}" uses unsupported type "${field.type}" - mapped to text()`,
      )
    }

    const optionsStr = options.length > 0 ? `{ ${options.join(', ')} }` : ''
    return `${mapping.type}(${optionsStr})`
  }

  /**
   * Generate list access control
   */
  private generateListAccess(
    hasOwnerAccess: boolean,
    model: IntrospectedModel,
    answers: Record<string, unknown>,
  ): string {
    const defaultAccess = (answers.default_access as string) || 'public-read-auth-write'

    if (hasOwnerAccess) {
      // Find the user relationship field
      const userField = model.fields.find(
        (f) =>
          f.relation?.model === 'User' ||
          f.name.toLowerCase().includes('author') ||
          f.name.toLowerCase().includes('owner') ||
          f.name.toLowerCase().includes('user'),
      )

      const ownerField = userField?.name || 'author'
      const ownerIdField = ownerField.endsWith('Id') ? ownerField : `${ownerField}Id`

      return `
      access: {
        operation: {
          query: () => true,
          create: ({ session }) => !!session,
          update: isOwner,
          delete: isOwner,
        },
        filter: {
          // Optionally filter queries to only show user's own items
          // query: ({ session }) => session ? { ${ownerIdField}: { equals: session.userId } } : true,
        },
      },`
    }

    // Generate based on default access pattern
    switch (defaultAccess) {
      case 'authenticated-only':
        return `
      access: {
        operation: {
          query: ({ session }) => !!session,
          create: ({ session }) => !!session,
          update: ({ session }) => !!session,
          delete: ({ session }) => !!session,
        },
      },`

      case 'owner-only':
        return `
      access: {
        operation: {
          query: ({ session }) => !!session,
          create: ({ session }) => !!session,
          update: ({ session }) => !!session,
          delete: ({ session }) => !!session,
        },
        // Add filter to scope to user's own items:
        // filter: { query: ({ session }) => ({ userId: { equals: session?.userId } }) },
      },`

      case 'admin-only':
        return `
      access: {
        operation: {
          query: ({ session }) => session?.role === 'admin',
          create: ({ session }) => session?.role === 'admin',
          update: ({ session }) => session?.role === 'admin',
          delete: ({ session }) => session?.role === 'admin',
        },
      },`

      case 'public-read-auth-write':
      default:
        return `
      access: {
        operation: {
          query: () => true,
          create: ({ session }) => !!session,
          update: ({ session }) => !!session,
          delete: ({ session }) => !!session,
        },
      },`
    }
  }

  /**
   * Generate access control helper functions
   */
  private generateAccessHelpers(answers: Record<string, unknown>): string {
    const helpers: string[] = []
    const ownerModels = (answers.models_with_owner as string[]) || []

    if (ownerModels.length > 0) {
      helpers.push(`/**
 * Access control helpers
 */

// Check if user owns the item (based on authorId or userId)
const isOwner: AccessControl = ({ session, item }) => {
  if (!session) return false
  // Try authorId first, then userId
  const ownerId = (item as any)?.authorId || (item as any)?.userId
  return ownerId === session.userId
}
`)
    }

    return helpers.join('\n')
  }

  /**
   * Generate database configuration
   */
  private generateDatabaseConfig(provider: string): {
    provider: string
    configCode: string
    imports: string[]
  } {
    switch (provider) {
      case 'postgresql':
        return {
          provider: 'postgresql',
          imports: [
            "import { PrismaPg } from '@prisma/adapter-pg'",
            "import pg from 'pg'",
          ],
          configCode: `    db: {
      provider: 'postgresql',
      prismaClientConstructor: (PrismaClient) => {
        const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
        const adapter = new PrismaPg(pool)
        return new PrismaClient({ adapter })
      },
    },`,
        }

      case 'mysql':
        return {
          provider: 'mysql',
          imports: [
            "import { PrismaPlanetScale } from '@prisma/adapter-planetscale'",
          ],
          configCode: `    db: {
      provider: 'mysql',
      prismaClientConstructor: (PrismaClient) => {
        const adapter = new PrismaPlanetScale({
          url: process.env.DATABASE_URL!,
        })
        return new PrismaClient({ adapter })
      },
    },`,
        }

      case 'sqlite':
      default:
        return {
          provider: 'sqlite',
          imports: [
            "import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'",
          ],
          configCode: `    db: {
      provider: 'sqlite',
      prismaClientConstructor: (PrismaClient) => {
        const adapter = new PrismaBetterSqlite3({
          url: process.env.DATABASE_URL || 'file:./dev.db',
        })
        return new PrismaClient({ adapter })
      },
    },`,
        }
    }
  }

  /**
   * Generate import statements
   */
  private generateImports(
    usedFieldTypes: Set<string>,
    useAuth: boolean,
    dbProvider: string,
  ): string {
    const imports: string[] = []

    // Core imports
    imports.push("import { config, list } from '@opensaas/stack-core'")

    // Field imports
    const fieldTypes = Array.from(usedFieldTypes).sort()
    imports.push(`import { ${fieldTypes.join(', ')} } from '@opensaas/stack-core/fields'`)

    // Auth imports
    if (useAuth) {
      imports.push("import { authPlugin } from '@opensaas/stack-auth'")
      imports.push("import type { AccessControl } from '@opensaas/stack-core'")
    }

    // Database adapter imports
    const dbConfig = this.generateDatabaseConfig(dbProvider)
    imports.push(...dbConfig.imports)

    return imports.join('\n')
  }

  /**
   * Assemble the complete config file
   */
  private assembleConfig(options: {
    imports: string
    accessHelpers: string
    dbConfig: { configCode: string }
    lists: string
    useAuth: boolean
    authMethods: string[]
    adminBasePath: string
  }): string {
    const { imports, accessHelpers, dbConfig, lists, useAuth, authMethods, adminBasePath } =
      options

    // Generate auth plugin config
    let authPluginStr = ''
    if (useAuth) {
      const authOptions: string[] = []

      if (authMethods.includes('email-password')) {
        authOptions.push(`      emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
      },`)
      }

      if (authMethods.includes('magic-link')) {
        authOptions.push(`      magicLink: {
        enabled: true,
      },`)
      }

      // OAuth providers would need additional setup
      if (authMethods.includes('google')) {
        authOptions.push(`      // Uncomment and configure Google OAuth:
      // google: {
      //   clientId: process.env.GOOGLE_CLIENT_ID!,
      //   clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // },`)
      }

      if (authMethods.includes('github')) {
        authOptions.push(`      // Uncomment and configure GitHub OAuth:
      // github: {
      //   clientId: process.env.GITHUB_CLIENT_ID!,
      //   clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      // },`)
      }

      authOptions.push(`      sessionFields: ['userId', 'email', 'name'],`)

      authPluginStr = `    authPlugin({
${authOptions.join('\n')}
    }),`
    }

    // Build config body
    const pluginsBlock = useAuth
      ? `  plugins: [
${authPluginStr}
  ],

`
      : ''

    const configBody = `export default config({
${pluginsBlock}${dbConfig.configCode}
  lists: {
${lists}
  },
  ui: {
    basePath: '${adminBasePath}',
  },
})`

    return `${imports}

${accessHelpers}${configBody}
`
  }

  /**
   * Generate list of dependencies to install
   */
  private generateDependencies(dbProvider: string, useAuth: boolean): string[] {
    const deps: string[] = [
      '@opensaas/stack-core',
      '@opensaas/stack-ui',
      '@prisma/client',
      'prisma',
    ]

    // Database adapter deps
    switch (dbProvider) {
      case 'postgresql':
        deps.push('@prisma/adapter-pg', 'pg', '@types/pg')
        break
      case 'mysql':
        deps.push('@prisma/adapter-planetscale')
        break
      case 'sqlite':
      default:
        deps.push('@prisma/adapter-better-sqlite3')
        break
    }

    // Auth deps
    if (useAuth) {
      deps.push('@opensaas/stack-auth', 'better-auth')
    }

    return deps
  }

  /**
   * Generate additional files if needed
   */
  private generateAdditionalFiles(
    answers: Record<string, unknown>,
    dbProvider: string,
  ): Array<{
    path: string
    content: string
    language: string
    description: string
  }> {
    const files: Array<{
      path: string
      content: string
      language: string
      description: string
    }> = []

    // Generate .env.example
    const envVars: string[] = ['# Database']

    // Database URL based on provider
    switch (dbProvider) {
      case 'postgresql':
        envVars.push('DATABASE_URL="postgresql://user:password@localhost:5432/mydb"')
        break
      case 'mysql':
        envVars.push('DATABASE_URL="mysql://user:password@localhost:3306/mydb"')
        break
      case 'sqlite':
      default:
        envVars.push('DATABASE_URL="file:./dev.db"')
        break
    }

    envVars.push('')

    if (answers.enable_auth) {
      envVars.push('# Auth')
      envVars.push('BETTER_AUTH_SECRET="generate-with-openssl-rand-base64-32"')
      envVars.push('BETTER_AUTH_URL="http://localhost:3000"')
      envVars.push('')

      const authMethods = (answers.auth_methods as string[]) || []
      if (authMethods.includes('google')) {
        envVars.push('# Google OAuth (optional)')
        envVars.push('GOOGLE_CLIENT_ID=""')
        envVars.push('GOOGLE_CLIENT_SECRET=""')
        envVars.push('')
      }
      if (authMethods.includes('github')) {
        envVars.push('# GitHub OAuth (optional)')
        envVars.push('GITHUB_CLIENT_ID=""')
        envVars.push('GITHUB_CLIENT_SECRET=""')
        envVars.push('')
      }
    }

    files.push({
      path: '.env.example',
      content: envVars.join('\n'),
      language: 'bash',
      description: 'Environment variables template',
    })

    return files
  }

  /**
   * Generate next steps
   */
  private generateSteps(useAuth: boolean, dbProvider: string): string[] {
    const steps = [
      'Save the generated config to `opensaas.config.ts`',
      'Copy `.env.example` to `.env` and fill in values',
    ]

    if (useAuth) {
      steps.push('Generate BETTER_AUTH_SECRET: `openssl rand -base64 32`')
    }

    steps.push(
      'Install dependencies: `pnpm add <dependencies>`',
      'Generate Prisma schema: `pnpm opensaas generate`',
      'Generate Prisma client: `npx prisma generate`',
      'Push schema to database: `npx prisma db push`',
      'Start development server: `pnpm dev`',
    )

    const adminPath = useAuth ? '' : '/admin'
    steps.push(`Visit admin UI at http://localhost:3000${adminPath}`)

    return steps
  }
}
