# Phase 4: Schema Introspectors

## Task Overview

Create introspectors that analyze existing Prisma schemas and KeystoneJS configs to extract model definitions, field types, relationships, and other metadata needed for migration.

## Context

### How Introspectors Are Used

The introspectors are called by:
1. **MCP Tools** - `opensaas_introspect_prisma`, `opensaas_introspect_keystone`
2. **CLI Command** - `opensaas migrate` for initial analysis
3. **Migration Wizard** - To generate dynamic questions

They parse source files and return structured data that other components use.

### Shared Types

From `packages/cli/src/migration/types.ts` (created in Phase 1):

```typescript
export interface IntrospectedModel {
  name: string
  fields: IntrospectedField[]
  hasRelations: boolean
  primaryKey: string
}

export interface IntrospectedField {
  name: string
  type: string
  isRequired: boolean
  isUnique: boolean
  isId: boolean
  isList: boolean
  defaultValue?: string
  relation?: {
    name: string
    model: string
    fields: string[]
    references: string[]
  }
}

export interface IntrospectedSchema {
  provider: string
  models: IntrospectedModel[]
  enums: Array<{ name: string; values: string[] }>
}
```

### Existing Generator Pattern

The codebase has a Prisma schema generator at `packages/cli/src/generator/prisma.ts` that can be referenced for parsing patterns. It uses regex to parse schema files.

---

## Requirements

### 1. Prisma Introspector

**File to create:** `packages/cli/src/migration/introspectors/prisma-introspector.ts`

Must parse:
- Datasource block (provider)
- Model definitions with all fields
- Field types and modifiers (`?`, `[]`, `@id`, `@unique`, `@default`)
- Relationships (`@relation`)
- Enums

### 2. KeystoneJS Introspector

**File to create:** `packages/cli/src/migration/introspectors/keystone-introspector.ts`

Must parse:
- Load TypeScript config using jiti
- Extract lists and their fields
- Map KeystoneJS field types to OpenSaaS equivalents
- Extract access control patterns (for reference)

### 3. Next.js Introspector

**File to create:** `packages/cli/src/migration/introspectors/nextjs-introspector.ts`

Must detect:
- Next.js version
- Auth libraries (next-auth, clerk, etc.)
- Database libraries (prisma, drizzle, etc.)
- App router vs pages router

---

## File Templates

### `packages/cli/src/migration/introspectors/prisma-introspector.ts`

```typescript
/**
 * Prisma Schema Introspector
 *
 * Parses prisma/schema.prisma and extracts structured information
 * about models, fields, relationships, and enums.
 */

import fs from 'fs-extra'
import path from 'path'
import type { IntrospectedSchema, IntrospectedModel, IntrospectedField } from '../types.js'

export class PrismaIntrospector {
  /**
   * Introspect a Prisma schema file
   */
  async introspect(cwd: string, schemaPath: string = 'prisma/schema.prisma'): Promise<IntrospectedSchema> {
    const fullPath = path.isAbsolute(schemaPath) ? schemaPath : path.join(cwd, schemaPath)

    if (!await fs.pathExists(fullPath)) {
      throw new Error(`Schema file not found: ${fullPath}`)
    }

    const schema = await fs.readFile(fullPath, 'utf-8')

    return {
      provider: this.extractProvider(schema),
      models: this.extractModels(schema),
      enums: this.extractEnums(schema),
    }
  }

  /**
   * Extract database provider from datasource block
   */
  private extractProvider(schema: string): string {
    const match = schema.match(/datasource\s+\w+\s*\{[^}]*provider\s*=\s*"(\w+)"/)
    return match ? match[1] : 'unknown'
  }

  /**
   * Extract all model definitions
   */
  private extractModels(schema: string): IntrospectedModel[] {
    const models: IntrospectedModel[] = []

    // Match model blocks
    const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g
    let match

    while ((match = modelRegex.exec(schema)) !== null) {
      const name = match[1]
      const body = match[2]

      const fields = this.extractFields(body)
      const primaryKey = fields.find(f => f.isId)?.name || 'id'

      models.push({
        name,
        fields,
        hasRelations: fields.some(f => f.relation !== undefined),
        primaryKey,
      })
    }

    return models
  }

  /**
   * Extract fields from a model body
   */
  private extractFields(body: string): IntrospectedField[] {
    const fields: IntrospectedField[] = []
    const lines = body.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()

      // Skip empty lines, comments, and model-level attributes
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) {
        continue
      }

      const field = this.parseFieldLine(trimmed)
      if (field) {
        fields.push(field)
      }
    }

    return fields
  }

  /**
   * Parse a single field line
   */
  private parseFieldLine(line: string): IntrospectedField | null {
    // Basic field pattern: name Type modifiers attributes
    // Examples:
    //   id        String   @id @default(cuid())
    //   title     String
    //   isActive  Boolean? @default(true)
    //   posts     Post[]
    //   author    User     @relation(fields: [authorId], references: [id])

    // Remove comments
    const withoutComment = line.split('//')[0].trim()

    // Match field name and type
    const fieldMatch = withoutComment.match(/^(\w+)\s+(\w+)(\?)?(\[\])?(.*)$/)
    if (!fieldMatch) return null

    const [, name, rawType, optional, isList, rest] = fieldMatch

    // Skip if this looks like an index or other non-field line
    if (['@@', 'index', 'unique'].some(kw => name.startsWith(kw))) {
      return null
    }

    const field: IntrospectedField = {
      name,
      type: rawType,
      isRequired: !optional,
      isUnique: rest.includes('@unique'),
      isId: rest.includes('@id'),
      isList: !!isList,
    }

    // Extract default value
    const defaultMatch = rest.match(/@default\(([^)]+)\)/)
    if (defaultMatch) {
      field.defaultValue = defaultMatch[1]
    }

    // Extract relation
    const relationMatch = rest.match(/@relation\(([^)]+)\)/)
    if (relationMatch) {
      const relationBody = relationMatch[1]

      // Parse relation parts
      const fieldsMatch = relationBody.match(/fields:\s*\[([^\]]+)\]/)
      const referencesMatch = relationBody.match(/references:\s*\[([^\]]+)\]/)
      const nameMatch = relationBody.match(/name:\s*"([^"]+)"/) || relationBody.match(/"([^"]+)"/)

      field.relation = {
        name: nameMatch ? nameMatch[1] : '',
        model: rawType,
        fields: fieldsMatch ? fieldsMatch[1].split(',').map(f => f.trim()) : [],
        references: referencesMatch ? referencesMatch[1].split(',').map(r => r.trim()) : [],
      }
    }

    return field
  }

  /**
   * Extract enum definitions
   */
  private extractEnums(schema: string): Array<{ name: string; values: string[] }> {
    const enums: Array<{ name: string; values: string[] }> = []

    // Match enum blocks
    const enumRegex = /enum\s+(\w+)\s*\{([^}]+)\}/g
    let match

    while ((match = enumRegex.exec(schema)) !== null) {
      const name = match[1]
      const body = match[2]

      const values = body
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('//'))

      enums.push({ name, values })
    }

    return enums
  }

  /**
   * Map Prisma type to OpenSaaS field type
   */
  mapPrismaTypeToOpenSaas(prismaType: string): { type: string; import: string } {
    const mappings: Record<string, { type: string; import: string }> = {
      'String': { type: 'text', import: 'text' },
      'Int': { type: 'integer', import: 'integer' },
      'Float': { type: 'float', import: 'float' },
      'Boolean': { type: 'checkbox', import: 'checkbox' },
      'DateTime': { type: 'timestamp', import: 'timestamp' },
      'Json': { type: 'json', import: 'json' },
      'BigInt': { type: 'text', import: 'text' }, // No native support
      'Decimal': { type: 'text', import: 'text' }, // No native support
      'Bytes': { type: 'text', import: 'text' }, // No native support
    }

    return mappings[prismaType] || { type: 'text', import: 'text' }
  }

  /**
   * Get warnings for unsupported features
   */
  getWarnings(schema: IntrospectedSchema): string[] {
    const warnings: string[] = []

    // Check for unsupported types
    for (const model of schema.models) {
      for (const field of model.fields) {
        if (['BigInt', 'Decimal', 'Bytes'].includes(field.type)) {
          warnings.push(`Field "${model.name}.${field.name}" uses unsupported type "${field.type}" - will be mapped to text()`)
        }
      }
    }

    // Check for composite IDs
    // This would require checking for @@id in the original schema

    return warnings
  }
}
```

### `packages/cli/src/migration/introspectors/keystone-introspector.ts`

```typescript
/**
 * KeystoneJS Config Introspector
 *
 * Loads keystone.config.ts using jiti and extracts list definitions.
 * KeystoneJS → OpenSaaS migration is mostly 1:1.
 */

import path from 'path'
import fs from 'fs-extra'
import { createJiti } from 'jiti'

export interface KeystoneList {
  name: string
  fields: KeystoneField[]
  access?: Record<string, unknown>
  hooks?: Record<string, unknown>
}

export interface KeystoneField {
  name: string
  type: string
  options?: Record<string, unknown>
}

export interface KeystoneSchema {
  lists: KeystoneList[]
  db?: {
    provider: string
    url?: string
  }
}

export class KeystoneIntrospector {
  /**
   * Introspect a KeystoneJS config file
   */
  async introspect(cwd: string, configPath: string = 'keystone.config.ts'): Promise<KeystoneSchema> {
    const fullPath = path.isAbsolute(configPath) ? configPath : path.join(cwd, configPath)

    // Try alternative paths
    const paths = [
      fullPath,
      path.join(cwd, 'keystone.ts'),
      path.join(cwd, 'keystone.config.js'),
    ]

    let foundPath: string | undefined
    for (const p of paths) {
      if (await fs.pathExists(p)) {
        foundPath = p
        break
      }
    }

    if (!foundPath) {
      throw new Error(`KeystoneJS config not found. Tried: ${paths.join(', ')}`)
    }

    try {
      // Use jiti to load TypeScript config
      const jiti = createJiti(import.meta.url, {
        interopDefault: true,
        moduleCache: false,
      })

      const configModule = await jiti.import(foundPath)
      const config = (configModule as any).default || configModule

      return this.parseConfig(config)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to load KeystoneJS config: ${message}`)
    }
  }

  /**
   * Parse the loaded KeystoneJS config object
   */
  private parseConfig(config: any): KeystoneSchema {
    const result: KeystoneSchema = {
      lists: [],
    }

    // Extract database config
    if (config.db) {
      result.db = {
        provider: config.db.provider || 'unknown',
        url: config.db.url,
      }
    }

    // Extract lists
    if (config.lists) {
      for (const [name, listDef] of Object.entries(config.lists)) {
        const list = this.parseList(name, listDef)
        result.lists.push(list)
      }
    }

    return result
  }

  /**
   * Parse a single list definition
   */
  private parseList(name: string, listDef: any): KeystoneList {
    const list: KeystoneList = {
      name,
      fields: [],
    }

    // Extract fields
    if (listDef.fields) {
      for (const [fieldName, fieldDef] of Object.entries(listDef.fields)) {
        const field = this.parseField(fieldName, fieldDef)
        list.fields.push(field)
      }
    }

    // Store access and hooks for reference (not used in migration but useful)
    if (listDef.access) {
      list.access = listDef.access
    }
    if (listDef.hooks) {
      list.hooks = listDef.hooks
    }

    return list
  }

  /**
   * Parse a single field definition
   */
  private parseField(name: string, fieldDef: any): KeystoneField {
    // KeystoneJS fields are objects with a type property or function results
    let type = 'unknown'
    let options: Record<string, unknown> = {}

    if (typeof fieldDef === 'object' && fieldDef !== null) {
      // Check for common field type patterns
      if (fieldDef.type) {
        type = fieldDef.type
      } else if (fieldDef._type) {
        type = fieldDef._type
      } else if (fieldDef.constructor?.name) {
        // Some field builders return objects with constructor name
        type = fieldDef.constructor.name
      }

      // Extract common options
      if (fieldDef.validation) options.validation = fieldDef.validation
      if (fieldDef.defaultValue !== undefined) options.defaultValue = fieldDef.defaultValue
      if (fieldDef.isRequired !== undefined) options.isRequired = fieldDef.isRequired
      if (fieldDef.ref) options.ref = fieldDef.ref
      if (fieldDef.many !== undefined) options.many = fieldDef.many
    }

    return { name, type, options }
  }

  /**
   * Map KeystoneJS field type to OpenSaaS equivalent
   */
  mapKeystoneTypeToOpenSaas(keystoneType: string): { type: string; import: string } {
    // KeystoneJS → OpenSaaS is mostly 1:1
    const mappings: Record<string, { type: string; import: string }> = {
      'text': { type: 'text', import: 'text' },
      'integer': { type: 'integer', import: 'integer' },
      'float': { type: 'float', import: 'float' },
      'checkbox': { type: 'checkbox', import: 'checkbox' },
      'timestamp': { type: 'timestamp', import: 'timestamp' },
      'select': { type: 'select', import: 'select' },
      'relationship': { type: 'relationship', import: 'relationship' },
      'password': { type: 'password', import: 'password' },
      'json': { type: 'json', import: 'json' },
      // KeystoneJS-specific types
      'image': { type: 'text', import: 'text' }, // Needs file storage plugin
      'file': { type: 'text', import: 'text' }, // Needs file storage plugin
      'virtual': { type: 'text', import: 'text' }, // Not supported
      'calendarDay': { type: 'timestamp', import: 'timestamp' },
    }

    const lower = keystoneType.toLowerCase()
    return mappings[lower] || { type: 'text', import: 'text' }
  }

  /**
   * Get warnings for unsupported features
   */
  getWarnings(schema: KeystoneSchema): string[] {
    const warnings: string[] = []

    for (const list of schema.lists) {
      for (const field of list.fields) {
        const lower = field.type.toLowerCase()

        if (['image', 'file'].includes(lower)) {
          warnings.push(`Field "${list.name}.${field.name}" uses "${field.type}" - consider adding file storage plugin`)
        }

        if (lower === 'virtual') {
          warnings.push(`Field "${list.name}.${field.name}" uses "virtual" - this is not supported, will be skipped`)
        }
      }
    }

    return warnings
  }
}
```

### `packages/cli/src/migration/introspectors/nextjs-introspector.ts`

```typescript
/**
 * Next.js Project Introspector
 *
 * Detects Next.js version, auth libraries, database libraries,
 * and other project characteristics.
 */

import path from 'path'
import fs from 'fs-extra'
import { glob } from 'glob'

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
  /**
   * Analyze a Next.js project
   */
  async introspect(cwd: string): Promise<NextjsAnalysis> {
    const packageJsonPath = path.join(cwd, 'package.json')

    if (!await fs.pathExists(packageJsonPath)) {
      throw new Error('package.json not found')
    }

    const pkg = await fs.readJSON(packageJsonPath)

    const analysis: NextjsAnalysis = {
      version: this.getNextVersion(pkg),
      routerType: await this.detectRouterType(cwd),
      typescript: await this.hasTypeScript(cwd),
      hasPrisma: this.hasDependency(pkg, '@prisma/client') || await fs.pathExists(path.join(cwd, 'prisma')),
      hasEnvFile: await fs.pathExists(path.join(cwd, '.env')) || await fs.pathExists(path.join(cwd, '.env.local')),
      existingDependencies: this.getAllDependencies(pkg),
    }

    // Detect auth library
    analysis.authLibrary = this.detectAuthLibrary(pkg)

    // Detect database library
    analysis.databaseLibrary = this.detectDatabaseLibrary(pkg)

    return analysis
  }

  /**
   * Get Next.js version from package.json
   */
  private getNextVersion(pkg: any): string {
    const version = pkg.dependencies?.next || pkg.devDependencies?.next || 'unknown'
    // Strip semver prefixes like ^ or ~
    return version.replace(/^[\^~]/, '')
  }

  /**
   * Detect if project uses app router, pages router, or both
   */
  private async detectRouterType(cwd: string): Promise<'app' | 'pages' | 'both' | 'unknown'> {
    const hasApp = await fs.pathExists(path.join(cwd, 'app')) ||
                   await fs.pathExists(path.join(cwd, 'src', 'app'))
    const hasPages = await fs.pathExists(path.join(cwd, 'pages')) ||
                     await fs.pathExists(path.join(cwd, 'src', 'pages'))

    if (hasApp && hasPages) return 'both'
    if (hasApp) return 'app'
    if (hasPages) return 'pages'
    return 'unknown'
  }

  /**
   * Check if project uses TypeScript
   */
  private async hasTypeScript(cwd: string): Promise<boolean> {
    return await fs.pathExists(path.join(cwd, 'tsconfig.json'))
  }

  /**
   * Check if package.json has a dependency
   */
  private hasDependency(pkg: any, name: string): boolean {
    return !!(pkg.dependencies?.[name] || pkg.devDependencies?.[name])
  }

  /**
   * Get all dependencies
   */
  private getAllDependencies(pkg: any): string[] {
    return [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
    ]
  }

  /**
   * Detect auth library being used
   */
  private detectAuthLibrary(pkg: any): string | undefined {
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

  /**
   * Detect database library being used
   */
  private detectDatabaseLibrary(pkg: any): string | undefined {
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

  /**
   * Get migration recommendations based on analysis
   */
  getRecommendations(analysis: NextjsAnalysis): string[] {
    const recommendations: string[] = []

    if (analysis.routerType === 'pages') {
      recommendations.push('Consider migrating to App Router for best OpenSaaS Stack integration')
    }

    if (analysis.authLibrary && analysis.authLibrary !== 'better-auth') {
      recommendations.push(`Consider migrating from ${analysis.authLibrary} to Better-auth (used by OpenSaaS Stack auth plugin)`)
    }

    if (!analysis.hasPrisma) {
      recommendations.push('OpenSaaS Stack uses Prisma - you\'ll need to set up your data models')
    }

    if (analysis.databaseLibrary && analysis.databaseLibrary !== 'prisma') {
      recommendations.push(`You\'re using ${analysis.databaseLibrary} - you may need to migrate to Prisma or run both`)
    }

    if (!analysis.hasEnvFile) {
      recommendations.push('Create a .env file with DATABASE_URL for your database connection')
    }

    return recommendations
  }

  /**
   * Get warnings for potential issues
   */
  getWarnings(analysis: NextjsAnalysis): string[] {
    const warnings: string[] = []

    if (analysis.version.startsWith('12') || analysis.version.startsWith('11')) {
      warnings.push(`Next.js ${analysis.version} is quite old - consider upgrading to 14+ for best results`)
    }

    if (analysis.databaseLibrary === 'mongoose') {
      warnings.push('MongoDB/Mongoose is not fully supported by Prisma - migration may require database change')
    }

    return warnings
  }
}
```

---

## Acceptance Criteria

### Prisma Introspector

1. **File Handling**
   - [ ] Reads schema from default path (`prisma/schema.prisma`)
   - [ ] Reads schema from custom path
   - [ ] Throws meaningful error if file not found

2. **Provider Detection**
   - [ ] Extracts provider from datasource block
   - [ ] Handles sqlite, postgresql, mysql, mongodb

3. **Model Extraction**
   - [ ] Finds all model definitions
   - [ ] Extracts model names correctly
   - [ ] Counts fields per model

4. **Field Parsing**
   - [ ] Parses field name and type
   - [ ] Detects optional fields (`?`)
   - [ ] Detects list fields (`[]`)
   - [ ] Detects `@id` fields
   - [ ] Detects `@unique` fields
   - [ ] Extracts `@default` values
   - [ ] Parses `@relation` with fields and references

5. **Enum Extraction**
   - [ ] Finds all enum definitions
   - [ ] Extracts enum values

6. **Type Mapping**
   - [ ] Maps all Prisma types to OpenSaaS equivalents
   - [ ] Generates warnings for unsupported types

### KeystoneJS Introspector

1. **Config Loading**
   - [ ] Loads TypeScript config using jiti
   - [ ] Handles keystone.config.ts
   - [ ] Handles keystone.ts
   - [ ] Throws meaningful error if not found

2. **List Extraction**
   - [ ] Extracts all list definitions
   - [ ] Extracts list names

3. **Field Extraction**
   - [ ] Extracts field names and types
   - [ ] Captures field options

4. **Type Mapping**
   - [ ] Maps KeystoneJS types to OpenSaaS equivalents
   - [ ] Generates warnings for unsupported types

### Next.js Introspector

1. **Project Detection**
   - [ ] Detects Next.js version
   - [ ] Detects router type (app/pages/both)
   - [ ] Detects TypeScript usage

2. **Library Detection**
   - [ ] Detects auth libraries
   - [ ] Detects database libraries
   - [ ] Lists all dependencies

3. **Recommendations**
   - [ ] Provides useful migration recommendations
   - [ ] Generates appropriate warnings

---

## Testing

### Unit Tests

Create `packages/cli/tests/introspectors/prisma-introspector.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PrismaIntrospector } from '../../src/migration/introspectors/prisma-introspector'
import fs from 'fs-extra'
import path from 'path'
import os from 'os'

describe('PrismaIntrospector', () => {
  let introspector: PrismaIntrospector
  let tempDir: string

  beforeEach(async () => {
    introspector = new PrismaIntrospector()
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prisma-test-'))
    await fs.ensureDir(path.join(tempDir, 'prisma'))
  })

  afterEach(async () => {
    await fs.remove(tempDir)
  })

  it('should parse a simple schema', async () => {
    const schema = `
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

model User {
  id    String @id @default(cuid())
  email String @unique
  name  String?
  posts Post[]
}

model Post {
  id       String @id @default(cuid())
  title    String
  author   User   @relation(fields: [authorId], references: [id])
  authorId String
}
`
    await fs.writeFile(path.join(tempDir, 'prisma', 'schema.prisma'), schema)

    const result = await introspector.introspect(tempDir)

    expect(result.provider).toBe('sqlite')
    expect(result.models).toHaveLength(2)

    const user = result.models.find(m => m.name === 'User')
    expect(user).toBeDefined()
    expect(user!.fields).toHaveLength(4)

    const post = result.models.find(m => m.name === 'Post')
    expect(post).toBeDefined()
    expect(post!.hasRelations).toBe(true)
  })

  it('should parse enums', async () => {
    const schema = `
datasource db {
  provider = "postgresql"
}

enum Role {
  USER
  ADMIN
  MODERATOR
}

model User {
  id   String @id
  role Role   @default(USER)
}
`
    await fs.writeFile(path.join(tempDir, 'prisma', 'schema.prisma'), schema)

    const result = await introspector.introspect(tempDir)

    expect(result.enums).toHaveLength(1)
    expect(result.enums[0].name).toBe('Role')
    expect(result.enums[0].values).toEqual(['USER', 'ADMIN', 'MODERATOR'])
  })

  it('should handle optional and list fields', async () => {
    const schema = `
datasource db {
  provider = "sqlite"
}

model User {
  id       String   @id
  name     String?
  emails   String[]
  isActive Boolean  @default(true)
}
`
    await fs.writeFile(path.join(tempDir, 'prisma', 'schema.prisma'), schema)

    const result = await introspector.introspect(tempDir)
    const user = result.models[0]

    const nameField = user.fields.find(f => f.name === 'name')
    expect(nameField!.isRequired).toBe(false)

    const emailsField = user.fields.find(f => f.name === 'emails')
    expect(emailsField!.isList).toBe(true)
  })

  it('should throw for missing schema', async () => {
    await expect(introspector.introspect(tempDir, 'nonexistent.prisma'))
      .rejects.toThrow('Schema file not found')
  })
})
```

### Manual Testing

```bash
# Build
cd packages/cli
pnpm build

# Test Prisma introspector
node -e "
import { PrismaIntrospector } from './dist/migration/introspectors/prisma-introspector.js'
const i = new PrismaIntrospector()
i.introspect('/path/to/prisma/project').then(console.log).catch(console.error)
"

# Test KeystoneJS introspector
node -e "
import { KeystoneIntrospector } from './dist/migration/introspectors/keystone-introspector.js'
const i = new KeystoneIntrospector()
i.introspect('/path/to/keystone/project').then(console.log).catch(console.error)
"
```
