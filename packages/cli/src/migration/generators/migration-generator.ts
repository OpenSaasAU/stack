/**
 * Migration Config Generator
 *
 * For KeystoneJS projects: produces a targeted migration guide showing specific
 * changes needed (imports, db config, auth). Lists, fields, hooks, and access
 * control copy over unchanged.
 *
 * For Prisma/Next.js projects: generates a full opensaas.config.ts from scratch.
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

  async generate(session: MigrationSession): Promise<MigrationOutput> {
    const { projectType, analysis, answers } = session

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

    if (projectType === 'keystone') {
      return this.generateKeystoneMigrationGuide(schema, answers)
    }

    const usedFieldTypes = new Set<string>(['text'])
    const warnings: string[] = []

    const lists = this.generateLists(schema, answers, usedFieldTypes, warnings)
    const accessHelpers = this.generateAccessHelpers(answers)
    const dbConfig = this.generateDatabaseConfig(
      (answers.db_provider as string) || analysis.provider || 'sqlite',
    )

    const useAuth = answers.enable_auth === true
    const imports = this.generateImports(usedFieldTypes, useAuth, dbConfig.provider)

    const configContent = this.assembleConfig({
      imports,
      accessHelpers,
      dbConfig,
      lists,
      useAuth,
      authMethods: (answers.auth_methods as string[]) || ['email-password'],
      adminBasePath: (answers.admin_base_path as string) || '/admin',
    })

    const dependencies = this.generateDependencies(dbConfig.provider, useAuth)
    const files = this.generateAdditionalFiles(answers, dbConfig.provider)
    const steps = this.generateSteps(useAuth, dbConfig.provider)

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

  private generateKeystoneMigrationGuide(
    schema: IntrospectedSchema | undefined,
    answers: Record<string, unknown>,
  ): MigrationOutput {
    const dbProvider = (answers.db_provider as string) || schema?.provider || 'sqlite'
    const useAuth = answers.enable_auth === true
    const hasM2M = schema?.models.some((m) => m.fields.some((f) => f.relation && f.isList))
    const hasVirtualFields = schema?.models.some((m) =>
      m.fields.some((f) => f.type.toLowerCase() === 'virtual'),
    )

    const warnings: string[] = []
    if (schema) {
      warnings.push(...this.keystoneIntrospector.getWarnings(schema))
    }

    // Build the targeted migration guide as the "config content"
    const dbAdapterExample = this.generateDatabaseAdapterExample(dbProvider)
    const authMigrationExample = useAuth ? this.generateAuthMigrationExample(answers) : ''
    const virtualFieldsNote = hasVirtualFields
      ? `\n## Step 5: Migrate Virtual Fields\n\nYour schema has \`virtual()\` fields. These work differently — OpenSaaS Stack has no GraphQL.\n\n\`\`\`diff\n- fullName: virtual({\n-   field: graphql.field({\n-     type: graphql.String,\n-     resolve: (item) => \`\${item.firstName} \${item.lastName}\`,\n-   }),\n- })\n+ fullName: virtual({\n+   type: 'string',\n+   hooks: {\n+     resolveOutput: ({ item }) => \`\${item.firstName} \${item.lastName}\`,\n+   },\n+ })\n\`\`\`\n\nKey changes: remove \`graphql.field()\` wrapper, replace \`resolve(item)\` with \`hooks.resolveOutput({ item })\`, declare \`type\` as a string. Field arguments are not supported. For context queries inside \`resolveOutput\`, use \`context.db.*\` instead of \`context.query.*\`.\n`
      : ''
    const contextGraphqlNote = `\n## Step ${hasVirtualFields ? '6' : '5'}: Migrate context.graphql Calls\n\nSearch your codebase for \`context.graphql.run(\`, \`context.graphql.raw(\`, and \`context.query.\`. Replace with \`context.db.{listName}.{method}()\` — list names are camelCase.\n\n\`\`\`diff\n- const { posts } = await context.graphql.run({\n-   query: \`query { posts(where: { status: { equals: published } }) { id title } }\`,\n- })\n+ const posts = await context.db.post.findMany({\n+   where: { status: { equals: 'published' } },\n+ })\n\`\`\`\n\nAccess control is enforced automatically. For nested data, make separate \`context.db\` calls per list.\n`
    const m2mNote = hasM2M
      ? `\n### Many-to-Many Join Tables\n\nKeystone and Prisma use different join table naming conventions. Add \`joinTableNaming: 'keystone'\` to preserve your existing data:\n\n\`\`\`typescript\ndb: {\n  provider: '${dbProvider}',\n  joinTableNaming: 'keystone', // Preserves Keystone join table names (e.g. _Post_tags)\n  prismaClientConstructor: ...\n}\n\`\`\`\n\nOr set per-relationship with \`db: { relationName: 'Post_tags' }\` on the relationship field.\n`
      : ''

    const configContent = `# KeystoneJS → OpenSaaS Stack: What to Change

Your lists, fields, hooks, and access control are **identical** between Keystone and OpenSaaS Stack.
Copy them to \`opensaas.config.ts\` unchanged. Only the following need updating:

---

## Step 1: Update Imports

\`\`\`diff
- import { config, list } from '@keystone-6/core'
- import { text, relationship, ... } from '@keystone-6/core/fields'
+ import { config, list } from '@opensaas/stack-core'
+ import { text, relationship, ... } from '@opensaas/stack-core/fields'
\`\`\`

${useAuth ? `\`\`\`diff\n- import { createAuth } from '@keystone-6/auth'\n- import { statelessSessions } from '@keystone-6/core/session'\n+ import { authPlugin } from '@opensaas/stack-auth'\n\`\`\`\n` : ''}
If you import types from \`.keystone/types\`, replace with:
\`\`\`diff
- import type { Session } from '.keystone/types'
+ import type { AccessControl } from '@opensaas/stack-core'
\`\`\`

---

## Step 2: Update Database Config

Add \`prismaClientConstructor\` — Prisma 7 requires a driver adapter.

${dbAdapterExample}
${m2mNote}
---

## Step 3: Update Session References

If your access control references \`session.data.id\`, change to \`session.userId\`:

\`\`\`diff
- const isAuthor = ({ session, item }) => item.authorId === session?.data.id
+ const isAuthor: AccessControl = ({ session, item }) => (item as { authorId: string }).authorId === session?.userId
\`\`\`
${authMigrationExample}
---

## Step 4: Keep Everything Else

Your lists, fields, hooks, and access control functions copy over unchanged.
The \`list()\`, field builders (\`text()\`, \`relationship()\`, etc.), and hook signatures are identical.
${virtualFieldsNote}${contextGraphqlNote}`

    const dependencies = this.generateKeystoneDependencies(dbProvider, useAuth)
    const steps = this.generateKeystoneSteps(useAuth, hasVirtualFields ?? false)

    return {
      configContent,
      dependencies,
      files: [],
      steps,
      warnings,
    }
  }

  private generateDatabaseAdapterExample(provider: string): string {
    switch (provider) {
      case 'postgresql':
        return `\`\`\`typescript
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

db: {
  provider: 'postgresql',
  url: process.env.DATABASE_URL,
  prismaClientConstructor: (PrismaClient) => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
    const adapter = new PrismaPg(pool)
    return new PrismaClient({ adapter })
  },
},
\`\`\``

      case 'mysql':
        return `\`\`\`typescript
import { PrismaPlanetScale } from '@prisma/adapter-planetscale'

db: {
  provider: 'mysql',
  url: process.env.DATABASE_URL,
  prismaClientConstructor: (PrismaClient) => {
    const adapter = new PrismaPlanetScale({ url: process.env.DATABASE_URL! })
    return new PrismaClient({ adapter })
  },
},
\`\`\``

      case 'sqlite':
      default:
        return `\`\`\`typescript
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

db: {
  provider: 'sqlite',
  url: process.env.DATABASE_URL || 'file:./dev.db',
  prismaClientConstructor: (PrismaClient) => {
    const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' })
    return new PrismaClient({ adapter })
  },
},
\`\`\``
    }
  }

  private generateAuthMigrationExample(answers: Record<string, unknown>): string {
    const authMethods = (answers.auth_methods as string[]) || ['email-password']
    const options: string[] = []

    if (authMethods.includes('email-password')) {
      options.push(`      emailAndPassword: { enabled: true },`)
    }
    if (authMethods.includes('magic-link')) {
      options.push(`      magicLink: { enabled: true },`)
    }
    if (authMethods.includes('google')) {
      options.push(
        `      // google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! },`,
      )
    }
    if (authMethods.includes('github')) {
      options.push(
        `      // github: { clientId: process.env.GITHUB_CLIENT_ID!, clientSecret: process.env.GITHUB_CLIENT_SECRET! },`,
      )
    }
    options.push(`      sessionFields: ['userId', 'email', 'name'],`)

    return `
---

## Auth Migration

Replace \`createAuth\`/\`withAuth\`/\`statelessSessions\` with \`authPlugin\`:

\`\`\`diff
- const { withAuth } = createAuth({ listKey: 'User', identityField: 'email', ... })
- export default withAuth(config({ ... }))
+ export default config({
+   plugins: [
+     authPlugin({
${options.map((o) => `+   ${o}`).join('\n')}
+     }),
+   ],
+   ...
+ })
\`\`\`

The auth plugin automatically provides User, Session, Account, and Verification lists.
**Remove those from your own \`lists\` config** if you have them.

**Access control:** unlike Keystone's \`User\` list (which you declared and
secured yourself), the auth plugin's lists ship **closed** by default — no
\`context.db\` reads/writes on User/Session/Account/Verification until you
grant access. Add the access rules your Keystone \`User\` list had via
\`authPlugin({ access: { user: { ... } } })\` (keyed by \`user\`/\`session\`/
\`account\`/\`verification\`, not the list name). Sign-in/sign-up are
unaffected — better-auth talks to these tables directly, bypassing access
control.
`
  }

  private generateKeystoneDependencies(dbProvider: string, useAuth: boolean): string[] {
    const remove = ['@keystone-6/core', '@keystone-6/auth', '@keystone-6/fields-document']
    const add: string[] = ['@opensaas/stack-core', '@opensaas/stack-ui']

    switch (dbProvider) {
      case 'postgresql':
        add.push('@prisma/adapter-pg', 'pg', '@types/pg')
        break
      case 'mysql':
        add.push('@prisma/adapter-planetscale')
        break
      case 'sqlite':
      default:
        add.push('@prisma/adapter-better-sqlite3', 'better-sqlite3')
        break
    }

    if (useAuth) {
      add.push('@opensaas/stack-auth', 'better-auth')
    }

    // Return as annotated strings so wizard output is readable
    return [`# Remove: ${remove.join(', ')}`, `# Add: ${add.join(', ')}`, ...add]
  }

  private generateKeystoneSteps(useAuth: boolean, hasVirtualFields: boolean): string[] {
    const steps = [
      'Rename keystone.ts → opensaas.config.ts',
      'Update imports: @keystone-6/core → @opensaas/stack-core',
      'Add prismaClientConstructor to db config (see guide above)',
    ]

    if (useAuth) {
      steps.push('Replace createAuth/withAuth with authPlugin (see guide above)')
      steps.push('Remove User/Session/Account lists from your config (auth plugin provides them)')
    }

    steps.push('Update session.data.id → session.userId in access control functions')

    if (hasVirtualFields) {
      steps.push(
        'Migrate virtual fields: replace graphql.field() + resolve() with hooks.resolveOutput (see guide above)',
      )
    }

    steps.push(
      'Search for context.graphql.run/raw and context.query.* calls and replace with context.db.* (see guide above)',
      'Run: pnpm opensaas generate',
      'Run: npx prisma db push',
      'Run: pnpm dev',
      'Visit admin UI at http://localhost:3000/admin',
    )

    return steps
  }

  private generateLists(
    schema: IntrospectedSchema | undefined,
    answers: Record<string, unknown>,
    usedFieldTypes: Set<string>,
    warnings: string[],
  ): string {
    if (!schema || schema.models.length === 0) {
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

    const skipAuthModels = answers.skip_auth_models === true
    const authModelNames = ['User', 'Account', 'Session', 'Verification']

    const modelsToGenerate = schema.models.filter((model) => {
      if (skipAuthModels && authModelNames.includes(model.name)) {
        return false
      }
      return true
    })

    const ownerModels = new Set((answers.models_with_owner as string[]) || [])

    const listDefinitions = modelsToGenerate.map((model) => {
      return this.generateList(
        model,
        schema,
        ownerModels.has(model.name),
        answers,
        usedFieldTypes,
        warnings,
      )
    })

    return listDefinitions.join('\n')
  }

  private generateList(
    model: IntrospectedModel,
    schema: IntrospectedSchema,
    hasOwnerAccess: boolean,
    answers: Record<string, unknown>,
    usedFieldTypes: Set<string>,
    warnings: string[],
  ): string {
    const fields: string[] = []

    // OpenSaaS adds id/createdAt/updatedAt automatically - skip them here
    const systemFields = ['id', 'createdAt', 'updatedAt']

    for (const field of model.fields) {
      if (systemFields.includes(field.name)) continue
      if (field.isId) continue

      const fieldDef = this.generateField(field, schema, usedFieldTypes, warnings)
      if (fieldDef) {
        fields.push(`        ${field.name}: ${fieldDef},`)
      }
    }

    const access = this.generateListAccess(hasOwnerAccess, model, answers)

    const fieldsBlock = fields.length > 0 ? `\n${fields.join('\n')}\n      ` : ''

    return `    ${model.name}: list({
      fields: {${fieldsBlock}},${access}
    }),`
  }

  private generateField(
    field: IntrospectedField,
    schema: IntrospectedSchema,
    usedFieldTypes: Set<string>,
    warnings: string[],
  ): string | null {
    if (field.relation) {
      usedFieldTypes.add('relationship')

      const relatedModel = schema.models.find((m) => m.name === field.relation!.model)
      const backRef = relatedModel?.fields.find(
        (f) => f.relation && f.relation.model === field.type,
      )

      const ref = backRef ? `${field.relation.model}.${backRef.name}` : field.relation.model

      const many = field.isList ? ', many: true' : ''
      return `relationship({ ref: '${ref}'${many} })`
    }

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

    const mapping = this.prismaIntrospector.mapPrismaTypeToOpenSaas(field.type)
    usedFieldTypes.add(mapping.import)

    const options: string[] = []

    if (field.isRequired && !field.defaultValue) {
      options.push('validation: { isRequired: true }')
    }

    if (field.isUnique) {
      options.push("isIndexed: 'unique'")
    }

    // Carry a declared `@db.Decimal(precision, scale)` through to the decimal() builder
    if (
      field.type === 'Decimal' &&
      field.nativeType?.name === 'Decimal' &&
      field.nativeType.args.length === 2
    ) {
      const [precision, scale] = field.nativeType.args
      options.push(`precision: ${precision}`)
      options.push(`scale: ${scale}`)
    }

    if (field.defaultValue) {
      if (field.type === 'DateTime' && field.defaultValue === 'now()') {
        options.push("defaultValue: { kind: 'now' }")
      } else if (field.type === 'Boolean') {
        options.push(`defaultValue: ${field.defaultValue}`)
      }
      // Other defaults are harder to map automatically
    }

    if (field.type === 'Bytes') {
      warnings.push(
        `Field "${field.name}" uses unsupported type "${field.type}" - mapped to text()`,
      )
    }

    // Float maps to decimal() - flag the type change (double -> decimal.js Decimal)
    if (field.type === 'Float') {
      warnings.push(
        `Field "${field.name}" uses type "Float" - mapped to decimal() (a decimal.js Decimal, not a JS number). Review precision/rounding.`,
      )
    }

    const optionsStr = options.length > 0 ? `{ ${options.join(', ')} }` : ''
    return `${mapping.type}(${optionsStr})`
  }

  private generateListAccess(
    hasOwnerAccess: boolean,
    model: IntrospectedModel,
    answers: Record<string, unknown>,
  ): string {
    const defaultAccess = (answers.default_access as string) || 'public-read-auth-write'

    if (hasOwnerAccess) {
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

  private generateDatabaseConfig(provider: string): {
    provider: string
    configCode: string
    imports: string[]
  } {
    switch (provider) {
      case 'postgresql':
        return {
          provider: 'postgresql',
          imports: ["import { PrismaPg } from '@prisma/adapter-pg'", "import pg from 'pg'"],
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
          imports: ["import { PrismaPlanetScale } from '@prisma/adapter-planetscale'"],
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
          imports: ["import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'"],
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

  private generateImports(
    usedFieldTypes: Set<string>,
    useAuth: boolean,
    dbProvider: string,
  ): string {
    const imports: string[] = []

    imports.push("import { config, list } from '@opensaas/stack-core'")

    const fieldTypes = Array.from(usedFieldTypes).sort()
    imports.push(`import { ${fieldTypes.join(', ')} } from '@opensaas/stack-core/fields'`)

    if (useAuth) {
      imports.push("import { authPlugin } from '@opensaas/stack-auth'")
      imports.push("import type { AccessControl } from '@opensaas/stack-core'")
    }

    const dbConfig = this.generateDatabaseConfig(dbProvider)
    imports.push(...dbConfig.imports)

    return imports.join('\n')
  }

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
