import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PrismaIntrospector } from '../../src/migration/introspectors/prisma-introspector.js'
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
  url      = env("DATABASE_URL")
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
  url      = "file:./dev.db"
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

    const isActiveField = user.fields.find(f => f.name === 'isActive')
    expect(isActiveField!.defaultValue).toBe('true')
  })

  it('should parse field attributes correctly', async () => {
    const schema = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id       String   @id @default(cuid())
  email    String   @unique
  username String
  age      Int
}
`
    await fs.writeFile(path.join(tempDir, 'prisma', 'schema.prisma'), schema)

    const result = await introspector.introspect(tempDir)
    const user = result.models[0]

    const idField = user.fields.find(f => f.name === 'id')
    expect(idField!.isId).toBe(true)
    expect(idField!.defaultValue).toBe('cuid()')

    const emailField = user.fields.find(f => f.name === 'email')
    expect(emailField!.isUnique).toBe(true)
  })

  it('should parse relationships correctly', async () => {
    const schema = `
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

model Post {
  id       String @id
  author   User   @relation(fields: [authorId], references: [id])
  authorId String
}

model User {
  id    String @id
  posts Post[]
}
`
    await fs.writeFile(path.join(tempDir, 'prisma', 'schema.prisma'), schema)

    const result = await introspector.introspect(tempDir)
    const post = result.models.find(m => m.name === 'Post')

    const authorField = post!.fields.find(f => f.name === 'author')
    expect(authorField!.relation).toBeDefined()
    expect(authorField!.relation!.model).toBe('User')
    expect(authorField!.relation!.fields).toEqual(['authorId'])
    expect(authorField!.relation!.references).toEqual(['id'])
  })

  it('should map Prisma types to OpenSaaS types', () => {
    expect(introspector.mapPrismaTypeToOpenSaas('String')).toEqual({ type: 'text', import: 'text' })
    expect(introspector.mapPrismaTypeToOpenSaas('Int')).toEqual({ type: 'integer', import: 'integer' })
    expect(introspector.mapPrismaTypeToOpenSaas('Boolean')).toEqual({ type: 'checkbox', import: 'checkbox' })
    expect(introspector.mapPrismaTypeToOpenSaas('DateTime')).toEqual({ type: 'timestamp', import: 'timestamp' })
    expect(introspector.mapPrismaTypeToOpenSaas('Json')).toEqual({ type: 'json', import: 'json' })
  })

  it('should generate warnings for unsupported types', async () => {
    const schema = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Data {
  id       String  @id
  bigValue BigInt
  decimal  Decimal
  bytes    Bytes
}
`
    await fs.writeFile(path.join(tempDir, 'prisma', 'schema.prisma'), schema)

    const result = await introspector.introspect(tempDir)
    const warnings = introspector.getWarnings(result)

    expect(warnings).toHaveLength(3)
    expect(warnings[0]).toContain('BigInt')
    expect(warnings[1]).toContain('Decimal')
    expect(warnings[2]).toContain('Bytes')
  })

  it('should throw for missing schema', async () => {
    await expect(introspector.introspect(tempDir, 'nonexistent.prisma'))
      .rejects.toThrow('Schema file not found')
  })

  it('should handle comments in schema', async () => {
    const schema = `
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

// This is a comment
model User {
  id    String @id // Comment after field
  // Another comment
  email String
}
`
    await fs.writeFile(path.join(tempDir, 'prisma', 'schema.prisma'), schema)

    const result = await introspector.introspect(tempDir)
    const user = result.models[0]

    expect(user.fields).toHaveLength(2)
    expect(user.fields.find(f => f.name === 'id')).toBeDefined()
    expect(user.fields.find(f => f.name === 'email')).toBeDefined()
  })

  it('should handle model-level attributes', async () => {
    const schema = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  firstName String
  lastName  String

  @@unique([firstName, lastName])
  @@index([lastName])
}
`
    await fs.writeFile(path.join(tempDir, 'prisma', 'schema.prisma'), schema)

    const result = await introspector.introspect(tempDir)
    const user = result.models[0]

    // Should only include actual fields, not model-level attributes
    expect(user.fields).toHaveLength(2)
    expect(user.fields.find(f => f.name === 'firstName')).toBeDefined()
    expect(user.fields.find(f => f.name === 'lastName')).toBeDefined()
  })
})
