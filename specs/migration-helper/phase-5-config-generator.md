# Phase 5: Migration Config Generator

## Task Overview

Create the config generator that takes migration session data (introspected schema + wizard answers) and produces a complete, working `opensaas.config.ts` file along with any additional files, dependencies, and instructions.

## Context

### How the Generator Is Used

The generator is called when the migration wizard completes:

```typescript
// In migration-wizard.ts
private async generateMigrationConfig(session: MigrationSession) {
  const output = await this.generator.generate(session)
  // Returns formatted markdown with config, deps, files, warnings, steps
}
```

### Input Data

The generator receives a `MigrationSession` with:

```typescript
interface MigrationSession {
  id: string
  projectType: 'prisma' | 'nextjs' | 'keystone'
  analysis: ProjectAnalysis
  answers: Record<string, string | boolean | string[]>
  // ...
}

interface ProjectAnalysis {
  projectTypes: ProjectType[]
  cwd: string
  models?: Array<{ name: string; fieldCount: number }>
  provider?: string
  hasAuth?: boolean
}
```

### Output Format

```typescript
interface MigrationOutput {
  configContent: string              // Complete opensaas.config.ts
  dependencies: string[]             // npm packages to install
  files: Array<{                     // Additional files
    path: string
    content: string
    language: string
    description: string
  }>
  steps: string[]                    // Next steps checklist
  warnings: string[]                 // Unsupported features
}
```

### Reference: Existing Config Structure

From `examples/starter-auth/opensaas.config.ts`:

```typescript
import { config, list } from '@opensaas/stack-core'
import { text, relationship, timestamp, select, password } from '@opensaas/stack-core/fields'
import { withAuth, authConfig } from '@opensaas/stack-auth'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import Database from 'better-sqlite3'

const isOwner = ({ session, item }: { session: any; item: any }) =>
  session?.userId === item?.authorId

export default withAuth(
  config({
    db: {
      provider: 'sqlite',
      url: process.env.DATABASE_URL || 'file:./dev.db',
      prismaClientConstructor: (PrismaClient) => {
        const db = new Database(process.env.DATABASE_URL?.replace('file:', '') || './dev.db')
        const adapter = new PrismaBetterSqlite3(db)
        return new PrismaClient({ adapter })
      },
    },
    lists: {
      Post: list({
        fields: {
          title: text({ validation: { isRequired: true } }),
          content: text({ ui: { displayMode: 'textarea' } }),
          status: select({
            options: [
              { label: 'Draft', value: 'draft' },
              { label: 'Published', value: 'published' },
            ],
            defaultValue: 'draft',
          }),
          author: relationship({ ref: 'User.posts' }),
          publishedAt: timestamp(),
        },
        access: {
          operation: {
            query: () => true,
            create: ({ session }) => !!session,
            update: isOwner,
            delete: isOwner,
          },
        },
      }),
    },
    ui: {
      basePath: '/admin',
    },
  }),
  authConfig({
    emailAndPassword: { enabled: true },
  })
)
```

---

## Requirements

### 1. Generate Complete Config

The generator must produce:

1. **Imports** - Based on used field types and features
2. **Access Control Helpers** - Based on wizard answers
3. **Database Configuration** - Provider-specific with Prisma 7 adapter
4. **List Definitions** - From introspected models with field mappings
5. **Auth Integration** - If enabled in wizard
6. **UI Configuration** - Admin base path

### 2. Handle Different Project Types

- **Prisma** - Map models and fields from introspected schema
- **KeystoneJS** - Nearly 1:1 mapping, update imports
- **Next.js** - Generate starter config with minimal models

### 3. Generate Access Control

Based on wizard answer `default_access`:
- `public-read-auth-write` - Anyone reads, authenticated writes
- `authenticated-only` - Only logged-in users
- `owner-only` - Users access only their own data
- `admin-only` - Only admins

Based on wizard answer `models_with_owner`:
- Generate owner check for specified models

---

## File Template

### `packages/cli/src/migration/generators/migration-generator.ts`

```typescript
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
      }
    } catch {
      // Continue without schema
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
      answers.db_provider as string || analysis.provider || 'sqlite'
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
    const files = this.generateAdditionalFiles(answers)

    // Generate next steps
    const steps = this.generateSteps(useAuth)

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
    answers: Record<string, any>,
    usedFieldTypes: Set<string>,
    warnings: string[]
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

    const modelsToGenerate = schema.models.filter(model => {
      if (skipAuthModels && authModelNames.includes(model.name)) {
        return false
      }
      return true
    })

    // Get models that should have owner access
    const ownerModels = new Set(answers.models_with_owner as string[] || [])

    // Generate each list
    const listDefinitions = modelsToGenerate.map(model => {
      return this.generateList(model, schema, ownerModels.has(model.name), answers, usedFieldTypes, warnings)
    })

    return listDefinitions.join('\n\n')
  }

  /**
   * Generate a single list definition
   */
  private generateList(
    model: IntrospectedModel,
    schema: IntrospectedSchema,
    hasOwnerAccess: boolean,
    answers: Record<string, any>,
    usedFieldTypes: Set<string>,
    warnings: string[]
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

    return `    ${model.name}: list({
      fields: {
${fields.join('\n')}
      },${access}
    }),`
  }

  /**
   * Generate a field definition
   */
  private generateField(
    field: IntrospectedField,
    schema: IntrospectedSchema,
    usedFieldTypes: Set<string>,
    warnings: string[]
  ): string | null {
    // Handle relationships
    if (field.relation) {
      usedFieldTypes.add('relationship')

      // Find the related model and back-reference field
      const relatedModel = schema.models.find(m => m.name === field.relation!.model)
      const backRef = relatedModel?.fields.find(f =>
        f.relation && f.relation.model === field.name.replace(/Id$/, '')
      )

      const ref = backRef
        ? `${field.relation.model}.${backRef.name}`
        : field.relation.model

      const many = field.isList ? ', many: true' : ''
      return `relationship({ ref: '${ref}'${many} })`
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

    // Handle enums as select fields
    const enumDef = schema.enums.find(e => e.name === field.type)
    if (enumDef) {
      usedFieldTypes.add('select')
      const enumOptions = enumDef.values
        .map(v => `{ label: '${v}', value: '${v}' }`)
        .join(', ')

      let selectOptions = `options: [${enumOptions}]`
      if (field.defaultValue) {
        selectOptions += `, defaultValue: '${field.defaultValue.replace(/'/g, '')}'`
      }
      return `select({ ${selectOptions} })`
    }

    // Handle default values
    if (field.defaultValue) {
      if (field.type === 'DateTime' && field.defaultValue === 'now()') {
        options.push("defaultValue: { kind: 'now' }")
      } else if (field.type === 'Boolean') {
        options.push(`defaultValue: ${field.defaultValue}`)
      }
      // Other defaults are harder to map, skip for now
    }

    // Generate unsupported type warning
    if (['BigInt', 'Decimal', 'Bytes'].includes(field.type)) {
      warnings.push(`Field "${field.name}" uses unsupported type "${field.type}" - mapped to text()`)
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
    answers: Record<string, any>
  ): string {
    const defaultAccess = answers.default_access as string || 'public-read-auth-write'

    if (hasOwnerAccess) {
      // Find the user relationship field
      const userField = model.fields.find(f =>
        f.relation?.model === 'User' ||
        f.name.toLowerCase().includes('author') ||
        f.name.toLowerCase().includes('owner') ||
        f.name.toLowerCase().includes('user')
      )

      const ownerField = userField?.name || 'authorId'
      const ownerIdField = ownerField.endsWith('Id') ? ownerField : `${ownerField}Id`

      return `
      access: {
        operation: {
          query: () => true,
          create: ({ session }) => !!session,
          update: ({ session, item }) => session?.userId === item?.${ownerIdField},
          delete: ({ session, item }) => session?.userId === item?.${ownerIdField},
        },
        filter: {
          // Optionally filter queries to only show user's own items
          // query: ({ session }) => ({ ${ownerIdField}: { equals: session?.userId } }),
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
  private generateAccessHelpers(answers: Record<string, any>): string {
    const helpers: string[] = []
    const ownerModels = answers.models_with_owner as string[] || []

    if (ownerModels.length > 0) {
      helpers.push(`// Access control helpers
const isAuthenticated = ({ session }: { session: any }) => !!session

const isOwner = ({ session, item }: { session: any; item: any }) =>
  session?.userId === item?.authorId

const isAdmin = ({ session }: { session: any }) =>
  session?.role === 'admin'
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
      url: process.env.DATABASE_URL!,
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
            "import { PrismaMySql } from '@prisma/adapter-mysql2'",
            "import mysql from 'mysql2/promise'",
          ],
          configCode: `    db: {
      provider: 'mysql',
      url: process.env.DATABASE_URL!,
      prismaClientConstructor: (PrismaClient) => {
        const pool = mysql.createPool(process.env.DATABASE_URL!)
        const adapter = new PrismaMySql(pool)
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
            "import Database from 'better-sqlite3'",
          ],
          configCode: `    db: {
      provider: 'sqlite',
      url: process.env.DATABASE_URL || 'file:./dev.db',
      prismaClientConstructor: (PrismaClient) => {
        const dbPath = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:', '')
        const db = new Database(dbPath)
        const adapter = new PrismaBetterSqlite3(db)
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
    dbProvider: string
  ): string {
    const imports: string[] = []

    // Core imports
    imports.push("import { config, list } from '@opensaas/stack-core'")

    // Field imports
    const fieldTypes = Array.from(usedFieldTypes).sort()
    imports.push(`import { ${fieldTypes.join(', ')} } from '@opensaas/stack-core/fields'`)

    // Auth imports
    if (useAuth) {
      imports.push("import { withAuth, authConfig } from '@opensaas/stack-auth'")
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
    const { imports, accessHelpers, dbConfig, lists, useAuth, authMethods, adminBasePath } = options

    // Generate auth config
    let authConfigStr = ''
    if (useAuth) {
      const authOptions: string[] = []
      if (authMethods.includes('email-password')) {
        authOptions.push('emailAndPassword: { enabled: true }')
      }
      if (authMethods.includes('magic-link')) {
        authOptions.push('magicLink: { enabled: true }')
      }
      // OAuth providers would need additional setup
      if (authMethods.includes('google')) {
        authOptions.push('// google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! }')
      }
      if (authMethods.includes('github')) {
        authOptions.push('// github: { clientId: process.env.GITHUB_CLIENT_ID!, clientSecret: process.env.GITHUB_CLIENT_SECRET! }')
      }

      authConfigStr = `
  authConfig({
    ${authOptions.join(',\n    ')}
  })`
    }

    // Build config body
    const configBody = `{
${dbConfig.configCode}
    lists: {
${lists}
    },
    ui: {
      basePath: '${adminBasePath}',
    },
  }`

    // Wrap with auth if needed
    const exportStatement = useAuth
      ? `export default withAuth(
  config(${configBody}),${authConfigStr}
)`
      : `export default config(${configBody})`

    return `${imports}

${accessHelpers}
${exportStatement}
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
        deps.push('@prisma/adapter-mysql2', 'mysql2')
        break
      case 'sqlite':
      default:
        deps.push('@prisma/adapter-better-sqlite3', 'better-sqlite3', '@types/better-sqlite3')
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
  private generateAdditionalFiles(answers: Record<string, any>): Array<{
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
    const envVars: string[] = [
      '# Database',
      'DATABASE_URL="file:./dev.db"',
      '',
    ]

    if (answers.enable_auth) {
      envVars.push('# Auth')
      envVars.push('BETTER_AUTH_SECRET="generate-with-openssl-rand-base64-32"')
      envVars.push('BETTER_AUTH_URL="http://localhost:3000"')
      envVars.push('')

      const authMethods = answers.auth_methods as string[] || []
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
  private generateSteps(useAuth: boolean): string[] {
    const steps = [
      'Save the generated config to `opensaas.config.ts`',
      'Copy `.env.example` to `.env` and fill in values',
      'Install dependencies: `pnpm add <dependencies>`',
      'Generate Prisma schema: `pnpm opensaas generate`',
      'Generate Prisma client: `npx prisma generate`',
      'Push schema to database: `npx prisma db push`',
      'Start development server: `pnpm dev`',
      `Visit admin UI at http://localhost:3000${useAuth ? '' : '/admin'}`,
    ]

    if (useAuth) {
      steps.splice(2, 0, 'Generate BETTER_AUTH_SECRET: `openssl rand -base64 32`')
    }

    return steps
  }
}
```

---

## Acceptance Criteria

1. **Config Generation**
   - [ ] Generates valid TypeScript config
   - [ ] Includes all necessary imports
   - [ ] Generates correct database adapter config for each provider
   - [ ] Lists have proper field definitions
   - [ ] Access control matches wizard answers

2. **Field Mapping**
   - [ ] Maps all Prisma types correctly
   - [ ] Handles relationships with proper refs
   - [ ] Handles enums as select fields
   - [ ] Handles optional fields
   - [ ] Handles unique fields
   - [ ] Handles default values where possible

3. **Auth Integration**
   - [ ] Wraps config with `withAuth` when enabled
   - [ ] Generates correct `authConfig` options
   - [ ] Skips User/Account/Session models when auth enabled

4. **Access Control**
   - [ ] Generates correct access for `public-read-auth-write`
   - [ ] Generates correct access for `authenticated-only`
   - [ ] Generates correct access for `owner-only`
   - [ ] Generates correct access for `admin-only`
   - [ ] Generates owner checks for specified models

5. **Dependencies**
   - [ ] Lists all required npm packages
   - [ ] Includes correct database adapter deps
   - [ ] Includes auth deps when enabled

6. **Additional Files**
   - [ ] Generates `.env.example` with all needed vars
   - [ ] Includes OAuth vars when those methods selected

7. **Next Steps**
   - [ ] Provides clear, ordered instructions
   - [ ] Includes auth-specific steps when needed

---

## Testing

### Unit Tests

Create `packages/cli/tests/migration-generator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { MigrationGenerator } from '../src/migration/generators/migration-generator'
import type { MigrationSession } from '../src/migration/types'

describe('MigrationGenerator', () => {
  const generator = new MigrationGenerator()

  it('should generate basic config', async () => {
    const session: MigrationSession = {
      id: 'test',
      projectType: 'prisma',
      analysis: {
        projectTypes: ['prisma'],
        cwd: '/tmp',
        provider: 'sqlite',
      },
      currentQuestionIndex: 0,
      answers: {
        preserve_database: true,
        db_provider: 'sqlite',
        enable_auth: false,
        default_access: 'public-read-auth-write',
        admin_base_path: '/admin',
      },
      isComplete: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const output = await generator.generate(session)

    expect(output.configContent).toContain("import { config, list } from '@opensaas/stack-core'")
    expect(output.configContent).toContain("provider: 'sqlite'")
    expect(output.dependencies).toContain('@opensaas/stack-core')
    expect(output.steps.length).toBeGreaterThan(0)
  })

  it('should include auth when enabled', async () => {
    const session: MigrationSession = {
      id: 'test',
      projectType: 'prisma',
      analysis: {
        projectTypes: ['prisma'],
        cwd: '/tmp',
      },
      currentQuestionIndex: 0,
      answers: {
        enable_auth: true,
        auth_methods: ['email-password'],
        db_provider: 'postgresql',
      },
      isComplete: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const output = await generator.generate(session)

    expect(output.configContent).toContain('withAuth')
    expect(output.configContent).toContain('authConfig')
    expect(output.dependencies).toContain('@opensaas/stack-auth')
    expect(output.dependencies).toContain('better-auth')
  })

  it('should generate owner access control', async () => {
    const session: MigrationSession = {
      id: 'test',
      projectType: 'prisma',
      analysis: {
        projectTypes: ['prisma'],
        cwd: '/tmp',
        models: [{ name: 'Post', fieldCount: 5 }],
      },
      currentQuestionIndex: 0,
      answers: {
        models_with_owner: ['Post'],
        default_access: 'public-read-auth-write',
      },
      isComplete: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const output = await generator.generate(session)

    expect(output.configContent).toContain('session?.userId === item?.')
  })
})
```

### Manual Testing

```bash
# Build
cd packages/cli
pnpm build

# Test generator directly
node -e "
import { MigrationGenerator } from './dist/migration/generators/migration-generator.js'
const g = new MigrationGenerator()
g.generate({
  id: 'test',
  projectType: 'prisma',
  analysis: { projectTypes: ['prisma'], cwd: process.cwd() },
  answers: { db_provider: 'sqlite', enable_auth: true, auth_methods: ['email-password'] },
  isComplete: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}).then(r => console.log(r.configContent))
"
```

### Integration Testing

1. Generate a config from a real Prisma project
2. Save to `opensaas.config.ts`
3. Run `opensaas generate`
4. Verify it succeeds without errors
5. Run `npx prisma generate`
6. Run `npx prisma db push`
7. Start the app and verify admin UI works
