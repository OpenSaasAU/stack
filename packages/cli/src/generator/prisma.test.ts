import { describe, it, expect } from 'vitest'
import { generatePrismaSchema, resolveListTimestamps } from './prisma.js'
import type { OpenSaasConfig, ListConfig, DatabaseConfig, FieldConfig } from '@opensaas/stack-core'
import type { TypeInfo } from '@opensaas/stack-core/extend'
import {
  text,
  integer,
  bigInt,
  relationship,
  checkbox,
  timestamp,
  select,
  json,
  decimal,
  calendarDay,
  virtual,
} from '@opensaas/stack-core/fields'

describe('Prisma Schema Generator', () => {
  describe('generatePrismaSchema', () => {
    it('should generate basic schema with datasource and generator', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {},
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toMatchSnapshot()
    })

    it('should use custom opensaasPath for generator output', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        opensaasPath: '.custom-path',
        lists: {},
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toMatchSnapshot()
    })

    it('should generate model with basic fields', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text({ validation: { isRequired: true } }),
              email: text({ validation: { isRequired: true } }),
              age: integer(),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toMatchSnapshot()
    })

    it('should generate a BigInt column for a bigInt() field (issue #907)', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Event: {
            fields: {
              occurredAtMs: bigInt({ validation: { isRequired: true } }),
              retries: bigInt({ defaultValue: 0n }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('occurredAtMs BigInt')
      expect(schema).toContain('retries      BigInt? @default(0)')
    })

    it('should generate model with checkbox field', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Post: {
            fields: {
              title: text(),
              isPublished: checkbox({ defaultValue: false }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toMatchSnapshot()
    })

    it('should generate model with timestamp field', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Post: {
            fields: {
              title: text(),
              publishedAt: timestamp(),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toMatchSnapshot()
    })

    it('should generate many-to-one relationship', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
          Post: {
            fields: {
              title: text(),
              author: relationship({ ref: 'User' }), // List-only reference (one-sided)
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toMatchSnapshot()
    })

    it('should generate one-to-many relationship', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
              posts: relationship({ ref: 'Post.author', many: true }),
            },
          },
          Post: {
            fields: {
              title: text(),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toMatchSnapshot()
    })

    it('should generate multiple models', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
          Post: {
            fields: {
              title: text(),
            },
          },
          Comment: {
            fields: {
              content: text(),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toMatchSnapshot()
    })

    it('should always include the id system field', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('id        String   @id @default(cuid())')
    })

    it('should NOT add timestamps by default (timestamps off — ADR-0004)', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).not.toContain('createdAt')
      expect(schema).not.toContain('updatedAt')
    })

    it('should add timestamps to all lists when db.timestamps is true', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          timestamps: true,
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
          Post: {
            fields: {
              title: text(),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Both lists receive the auto pair
      const createdAtCount = schema.match(/createdAt DateTime @default\(now\(\)\)/g)?.length
      const updatedAtCount = schema.match(
        /updatedAt DateTime @default\(now\(\)\) @updatedAt/g,
      )?.length
      expect(createdAtCount).toBe(2)
      expect(updatedAtCount).toBe(2)
    })

    it('should let a per-list db.timestamps override force timestamps off', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          timestamps: true,
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
          // Production opts out of timestamps even though they are enabled globally
          Production: {
            fields: {
              name: text(),
            },
            db: { timestamps: false },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Global on → User has them
      const userBlock = schema.slice(
        schema.indexOf('model User {'),
        schema.indexOf('model Production {'),
      )
      expect(userBlock).toContain('createdAt DateTime @default(now())')
      expect(userBlock).toContain('updatedAt DateTime @default(now()) @updatedAt')

      // Per-list off → Production does not
      const productionBlock = schema.slice(schema.indexOf('model Production {'))
      expect(productionBlock).not.toContain('createdAt')
      expect(productionBlock).not.toContain('updatedAt')
    })

    it('should let a per-list db.timestamps override force timestamps on', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // Global default is off
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
          // Audited opts in to timestamps even though they are off globally
          Audited: {
            fields: {
              name: text(),
            },
            db: { timestamps: true },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      const userBlock = schema.slice(
        schema.indexOf('model User {'),
        schema.indexOf('model Audited {'),
      )
      expect(userBlock).not.toContain('createdAt')
      expect(userBlock).not.toContain('updatedAt')

      const auditedBlock = schema.slice(schema.indexOf('model Audited {'))
      expect(auditedBlock).toContain('createdAt DateTime @default(now())')
      expect(auditedBlock).toContain('updatedAt DateTime @default(now()) @updatedAt')
    })

    it('should not duplicate a declared createdAt when timestamps are enabled (no P1012)', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          timestamps: true,
        },
        lists: {
          Post: {
            fields: {
              title: text(),
              // List declares its own createdAt — auto column must be skipped
              createdAt: timestamp(),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Exactly one createdAt column (the declared one), no duplicate
      const createdAtCount = schema.match(/^\s*createdAt\s/gm)?.length
      expect(createdAtCount).toBe(1)
      // The declared field maps to a plain DateTime?, not the auto @default(now())
      expect(schema).toContain('createdAt    DateTime?')
      expect(schema).not.toContain('createdAt DateTime @default(now())')
      // updatedAt is not declared, so the auto column is still emitted
      expect(schema).toContain('updatedAt DateTime @default(now()) @updatedAt')
    })

    it('should not duplicate declared createdAt and updatedAt when timestamps are enabled', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          timestamps: true,
        },
        lists: {
          Post: {
            fields: {
              title: text(),
              createdAt: timestamp(),
              updatedAt: timestamp(),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema.match(/^\s*createdAt\s/gm)?.length).toBe(1)
      expect(schema.match(/^\s*updatedAt\s/gm)?.length).toBe(1)
      // Neither auto column is emitted (both declared)
      expect(schema).not.toContain('createdAt DateTime @default(now())')
      expect(schema).not.toContain('updatedAt DateTime @default(now()) @updatedAt')
    })

    it('should handle empty lists config', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {},
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('generator client {')
      expect(schema).toContain('datasource db {')
      expect(schema).not.toContain('model')
    })

    it('should generate list-only ref (many-to-one) with synthetic field', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Category: {
            fields: {
              name: text(),
            },
          },
          Post: {
            fields: {
              title: text(),
              category: relationship({ ref: 'Category' }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Post should have categoryId foreign key and named relation
      expect(schema).toContain('categoryId   String?')
      expect(schema).toContain(
        'category     Category?  @relation("Post_category", fields: [categoryId], references: [id])',
      )

      // Category should have synthetic field with matching relation name
      expect(schema).toContain('from_Post_category Post[]  @relation("Post_category")')
    })

    it('should generate list-only ref (one-to-many) with synthetic field', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Category: {
            fields: {
              name: text(),
            },
          },
          Post: {
            fields: {
              title: text(),
              category: relationship({ ref: 'Category' }), // Many-to-one (no many: true)
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Post should have foreign key and relation
      expect(schema).toContain('categoryId   String?')
      expect(schema).toContain('category     Category?  @relation("Post_category"')

      // Category should have synthetic field with matching relation name
      expect(schema).toContain('from_Post_category Post[]  @relation("Post_category")')
    })

    it('should handle mix of bidirectional and list-only refs', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
              posts: relationship({ ref: 'Post.author', many: true }),
            },
          },
          Category: {
            fields: {
              name: text(),
            },
          },
          Post: {
            fields: {
              title: text(),
              author: relationship({ ref: 'User.posts' }),
              category: relationship({ ref: 'Category' }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Bidirectional relationship (no named relation)
      expect(schema).toContain('posts        Post[]')
      expect(schema).toContain(
        'author       User?  @relation(fields: [authorId], references: [id])',
      )

      // List-only relationship (named relation)
      expect(schema).toContain(
        'category     Category?  @relation("Post_category", fields: [categoryId], references: [id])',
      )
      expect(schema).toContain('from_Post_category Post[]  @relation("Post_category")')
    })

    it('should generate synthetic back-reference for list-only many-to-many (regression: 0.19.0)', () => {
      // Regression test: relationship({ ref: 'User', many: true }) stopped generating
      // back-reference fields on the target model in 0.19.0, causing Prisma validation errors:
      // "The relation field `readBy` on model `TextMessage` is missing an opposite relation field"
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
          TextMessage: {
            fields: {
              content: text(),
              readBy: relationship({ ref: 'User', many: true }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // TextMessage should have the relationship with named relation
      expect(schema).toContain('readBy       User[]  @relation("TextMessage_readBy")')

      // User MUST have the synthetic back-reference — Prisma requires both sides
      // of an implicit many-to-many to be defined or it throws a validation error
      expect(schema).toContain(
        'from_TextMessage_readBy TextMessage[]  @relation("TextMessage_readBy")',
      )
    })

    it('should handle multiple list-only refs pointing to same target', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Term: {
            fields: {
              name: text(),
            },
          },
          Bill: {
            fields: {
              name: text(),
              term: relationship({ ref: 'Term' }),
            },
          },
          Invoice: {
            fields: {
              number: text(),
              term: relationship({ ref: 'Term' }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Term should have two synthetic fields with different relation names
      expect(schema).toContain('from_Bill_term Bill[]  @relation("Bill_term")')
      expect(schema).toContain('from_Invoice_term Invoice[]  @relation("Invoice_term")')

      // Bill and Invoice should have correctly named relations
      expect(schema).toContain(
        'term         Term?  @relation("Bill_term", fields: [termId], references: [id])',
      )
      expect(schema).toContain(
        'term         Term?  @relation("Invoice_term", fields: [termId], references: [id])',
      )
    })

    it('should generate @map attribute for regular fields with db.map', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              firstName: text({
                validation: { isRequired: true },
                db: { map: 'first_name' },
              }),
              lastName: text({
                validation: { isRequired: true },
                db: { map: 'last_name' },
              }),
              email: text({
                validation: { isRequired: true },
                isIndexed: 'unique',
                db: { map: 'email_address' },
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('firstName    String @map("first_name")')
      expect(schema).toContain('lastName     String @map("last_name")')
      expect(schema).toContain('email        String @unique @map("email_address")')
    })

    it('should generate @map attribute for fields with different types', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Post: {
            fields: {
              title: text({ db: { map: 'post_title' } }),
              viewCount: integer({ db: { map: 'view_count' } }),
              isPublished: checkbox({ db: { map: 'is_published' } }),
              publishedAt: timestamp({ db: { map: 'published_at' } }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('title        String? @map("post_title")')
      expect(schema).toContain('viewCount    Int? @map("view_count")')
      expect(schema).toContain('isPublished  Boolean @map("is_published")')
      expect(schema).toContain('publishedAt  DateTime? @map("published_at")')
    })

    it('should generate @map attribute for foreign key with custom map', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
              posts: relationship({ ref: 'Post.author', many: true }),
            },
          },
          Post: {
            fields: {
              title: text(),
              author: relationship({
                ref: 'User.posts',
                db: { foreignKey: { map: 'author_user_id' } },
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('authorId     String? @map("author_user_id")')
      expect(schema).toContain(
        'author       User?  @relation(fields: [authorId], references: [id])',
      )
    })

    it('should default foreign key @map to field name for bidirectional relationships', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
              profile: relationship({
                ref: 'Profile.user',
                db: { foreignKey: true },
              }),
            },
          },
          Profile: {
            fields: {
              bio: text(),
              user: relationship({ ref: 'User.profile' }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Should default to field name 'profile', not 'profileId'
      expect(schema).toContain('profileId    String? @unique @map("profile")')
      expect(schema).toContain(
        'profile      Profile?  @relation(fields: [profileId], references: [id])',
      )
    })

    it('should handle mix of fields with and without db.map', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text({ db: { map: 'user_name' } }),
              email: text({ validation: { isRequired: true } }), // No db.map
              age: integer({ db: { map: 'user_age' } }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('name         String? @map("user_name")')
      expect(schema).toContain('email        String')
      expect(schema).not.toContain('email        String @map')
      expect(schema).toContain('age          Int? @map("user_age")')
    })

    it('should generate @map for list-only relationship foreign keys', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Category: {
            fields: {
              name: text(),
            },
          },
          Post: {
            fields: {
              title: text(),
              category: relationship({ ref: 'Category' }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // List-only refs should default to field name
      expect(schema).toContain('categoryId   String? @map("category")')
    })

    it('should generate a required FK column and relation field with db.isNullable: false', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
              posts: relationship({ ref: 'Post.author', many: true }),
            },
          },
          Post: {
            fields: {
              title: text(),
              author: relationship({
                ref: 'User.posts',
                db: { isNullable: false },
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('authorId     String @map("author")')
      expect(schema).not.toContain('authorId     String?')
      expect(schema).toContain('author       User  @relation(fields: [authorId], references: [id])')
      expect(schema).not.toContain('author       User?')
    })

    it('should default the FK column and relation field to nullable without db.isNullable', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
              posts: relationship({ ref: 'Post.author', many: true }),
            },
          },
          Post: {
            fields: {
              title: text(),
              author: relationship({ ref: 'User.posts' }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('authorId     String?')
      expect(schema).toContain(
        'author       User?  @relation(fields: [authorId], references: [id])',
      )
    })

    it('should generate a required FK for a list-only relationship with db.isNullable: false', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Category: {
            fields: {
              name: text(),
            },
          },
          Post: {
            fields: {
              title: text(),
              category: relationship({ ref: 'Category', db: { isNullable: false } }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('categoryId   String @map("category")')
      expect(schema).not.toContain('categoryId   String?')
    })

    it('should apply extendPrismaSchema to self-referential relationship with onDelete', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Category: {
            fields: {
              name: text(),
              parent: relationship({
                ref: 'Category.children',
                db: {
                  foreignKey: true,
                  extendPrismaSchema: ({ fkLine, relationLine }) => ({
                    fkLine,
                    relationLine: relationLine.replace(
                      '@relation(',
                      '@relation(onDelete: SetNull, ',
                    ),
                  }),
                },
              }),
              children: relationship({ ref: 'Category.parent', many: true }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('onDelete: SetNull')
      expect(schema).toContain(
        'parent       Category?  @relation(onDelete: SetNull, fields: [parentId], references: [id])',
      )
    })

    it('should apply extendPrismaSchema to modify FK line', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
        },
        lists: {
          User: {
            fields: {
              name: text(),
              posts: relationship({ ref: 'Post.author', many: true }),
            },
          },
          Post: {
            fields: {
              title: text(),
              author: relationship({
                ref: 'User.posts',
                db: {
                  extendPrismaSchema: ({ fkLine, relationLine }) => ({
                    // Add comment to FK field
                    fkLine: fkLine + ' // Author reference',
                    relationLine,
                  }),
                },
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('authorId     String? @map("author") // Author reference')
    })

    it('should apply extendPrismaSchema to many side relationship', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
              posts: relationship({
                ref: 'Post.author',
                many: true,
                db: {
                  extendPrismaSchema: ({ relationLine }) => ({
                    relationLine: relationLine + ' // User posts',
                  }),
                },
              }),
            },
          },
          Post: {
            fields: {
              title: text(),
              author: relationship({ ref: 'User.posts' }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('posts        Post[] // User posts')
    })

    it('should apply extendPrismaSchema to relationship without FK (other side of one-to-one)', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
              profile: relationship({
                ref: 'Profile.user',
                db: { foreignKey: true },
              }),
            },
          },
          Profile: {
            fields: {
              bio: text(),
              user: relationship({
                ref: 'User.profile',
                db: {
                  extendPrismaSchema: ({ relationLine }) => ({
                    relationLine: relationLine + ' // Back reference',
                  }),
                },
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('user         User? // Back reference')
    })

    it('should throw when db.isNullable is set on the non-FK-owning side of a one-to-one relationship', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
              profile: relationship({
                ref: 'Profile.user',
                db: { foreignKey: true },
              }),
            },
          },
          Profile: {
            fields: {
              bio: text(),
              // Wrong side: User.profile owns the FK, not Profile.user.
              user: relationship({ ref: 'User.profile', db: { isNullable: false } }),
            },
          },
        },
      }

      expect(() => generatePrismaSchema(config)).toThrow(
        'db.isNullable can only be used on the foreign-key-owning side',
      )
    })

    it('should generate @@index for foreign keys by default (matching Keystone behavior)', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
          Post: {
            fields: {
              title: text(),
              author: relationship({ ref: 'User' }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Should have foreign key field
      expect(schema).toContain('authorId     String?')
      // Should have index on foreign key
      expect(schema).toContain('@@index([authorId])')
    })

    it('should generate @@index when isIndexed is explicitly true', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
          Post: {
            fields: {
              title: text(),
              author: relationship({ ref: 'User', isIndexed: true }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('authorId     String?')
      expect(schema).toContain('@@index([authorId])')
    })

    it('should generate @@unique when isIndexed is "unique"', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
          Post: {
            fields: {
              title: text(),
              author: relationship({ ref: 'User', isIndexed: 'unique' }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('authorId     String?')
      expect(schema).toContain('@@unique([authorId])')
    })

    it('should not generate index when isIndexed is false', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
          Post: {
            fields: {
              title: text(),
              author: relationship({ ref: 'User', isIndexed: false }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('authorId     String?')
      // Should not have index
      expect(schema).not.toContain('@@index([authorId])')
      expect(schema).not.toContain('@@unique([authorId])')
    })

    // Prisma has no field-level `@index` attribute — `@id`, `@unique`,
    // `@default`, `@map`, `@relation`, `@updatedAt` and `@ignore` are the whole
    // field-level set. A non-unique index exists ONLY as the model-level
    // `@@index([...])`, so emitting an inline `@index` produces a schema Prisma
    // refuses to parse ("Attribute not known: @index").
    it('should generate @@index for a scalar field with isIndexed: true', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Post: {
            fields: {
              title: text({ isIndexed: true }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('@@index([title])')
      // The index must NOT ride along on the field line.
      expect(schema).not.toMatch(/\s@index\b/)
    })

    it('should generate @@index for every scalar type that accepts isIndexed', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
        },
        lists: {
          Reading: {
            fields: {
              label: text({ isIndexed: true }),
              amount: decimal({ isIndexed: true }),
              takenOn: calendarDay({ isIndexed: true }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('@@index([label])')
      expect(schema).toContain('@@index([amount])')
      expect(schema).toContain('@@index([takenOn])')
      expect(schema).not.toMatch(/\s@index\b/)
    })

    it('should keep isIndexed: "unique" as an inline @unique on scalar fields', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              email: text({ isIndexed: 'unique' }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // A unique index has a valid field-level form, so it stays inline —
      // unchanged from every schema this generator has ever produced.
      expect(schema).toMatch(/email\s+String\??\s+@unique/)
      expect(schema).not.toContain('@@unique([email])')
    })

    it('should not generate an index for a scalar without isIndexed', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Post: {
            fields: {
              title: text(),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).not.toContain('@@index([title])')
      expect(schema).not.toContain('@@unique([title])')
    })
  })

  describe('Model-level composite indexes (db.indexes) (#864)', () => {
    it('generates a composite @@unique across two relationship fields', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Student: {
            fields: { name: text() },
          },
          Production: {
            fields: { title: text() },
          },
          Audition: {
            fields: {
              student: relationship({ ref: 'Student' }),
              production: relationship({ ref: 'Production' }),
            },
            db: {
              indexes: [{ fields: ['student', 'production'], unique: true }],
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('@@unique([studentId, productionId])')
    })

    it('generates a composite @@index (non-unique) across scalar fields', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          AuthVerification: {
            fields: {
              identifier: text(),
              createdAt: timestamp(),
            },
            db: {
              indexes: [{ fields: ['identifier', 'createdAt'] }],
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('@@index([identifier, createdAt])')
      expect(schema).not.toContain('@@unique([identifier, createdAt])')
    })

    it('resolves a scalar field carrying db.map to its Prisma field name, not the mapped column', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Post: {
            fields: {
              firstName: text({ db: { map: 'first_name' } }),
              lastName: text(),
            },
            db: {
              indexes: [{ fields: ['firstName', 'lastName'], unique: true }],
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('@@unique([firstName, lastName])')
    })

    it('emits an optional constraint name as Prisma map:', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          AuthVerification: {
            fields: {
              identifier: text(),
              createdAt: timestamp(),
            },
            db: {
              indexes: [
                {
                  fields: ['identifier', 'createdAt'],
                  name: 'AuthVerification_identifier_createdAt_idx',
                },
              ],
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain(
        '@@index([identifier, createdAt], map: "AuthVerification_identifier_createdAt_idx")',
      )
    })

    it('emits an optional per-field sort direction', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          AuthVerification: {
            fields: {
              identifier: text(),
              createdAt: timestamp(),
            },
            db: {
              indexes: [{ fields: ['identifier', { field: 'createdAt', sort: 'desc' }] }],
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('@@index([identifier, createdAt(sort: Desc)])')
    })

    it('emits a composite index after field-level indexes, in declaration order', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: { name: text() },
          },
          Post: {
            fields: {
              title: text({ isIndexed: true }),
              author: relationship({ ref: 'User' }),
              category: text(),
            },
            db: {
              indexes: [{ fields: ['title', 'category'] }],
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)
      const titleIndex = schema.indexOf('@@index([title])')
      const authorIndex = schema.indexOf('@@index([authorId])')
      const compositeIndex = schema.indexOf('@@index([title, category])')

      expect(titleIndex).toBeGreaterThan(-1)
      expect(authorIndex).toBeGreaterThan(-1)
      expect(compositeIndex).toBeGreaterThan(-1)
      expect(compositeIndex).toBeGreaterThan(titleIndex)
      expect(compositeIndex).toBeGreaterThan(authorIndex)
    })

    it('leaves output unchanged for a config with no db.indexes', () => {
      const withoutIndexes: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: { title: text() },
          },
        },
      }
      const withEmptyIndexes: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: { title: text() },
            db: { indexes: [] },
          },
        },
      }

      expect(generatePrismaSchema(withEmptyIndexes)).toBe(generatePrismaSchema(withoutIndexes))
    })

    it('throws naming the list, entry, and field for an unknown field', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: { title: text() },
            db: { indexes: [{ fields: ['title', 'nope'] }] },
          },
        },
      }

      expect(() => generatePrismaSchema(config)).toThrow(
        /db\.indexes\[0\].*on list "Post".*unknown field "nope"/,
      )
    })

    it('throws for a virtual field', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: {
              title: text(),
              computed: virtual({
                type: 'string',
                hooks: { resolveOutput: () => 'x' },
              }),
            },
            db: { indexes: [{ fields: ['title', 'computed'] }] },
          },
        },
      }

      expect(() => generatePrismaSchema(config)).toThrow(/references virtual field "computed"/)
    })

    it('throws for a to-many relationship field', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          User: {
            fields: { name: text() },
          },
          Post: {
            fields: {
              title: text(),
              tags: relationship({ ref: 'User', many: true }),
            },
            db: { indexes: [{ fields: ['title', 'tags'] }] },
          },
        },
      }

      expect(() => generatePrismaSchema(config)).toThrow(
        /references to-many relationship field "tags"/,
      )
    })

    it('throws for the non-FK side of a one-to-one relationship', () => {
      // Neither side sets db.foreignKey explicitly, so ownership falls to the
      // alphabetical default: "Account" < "User", so Account owns the FK and
      // User.account is the non-FK side — the one db.indexes references here.
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Account: {
            fields: {
              user: relationship({ ref: 'User.account' }),
            },
          },
          User: {
            fields: {
              name: text(),
              account: relationship({ ref: 'Account.user' }),
            },
            db: { indexes: [{ fields: ['name', 'account'] }] },
          },
        },
      }

      expect(() => generatePrismaSchema(config)).toThrow(
        /does not own a foreign key column on this model/,
      )
    })

    describe('single-field entries (#918)', () => {
      it('emits @@unique with map: for a single-field entry with unique and a name', () => {
        const config: OpenSaasConfig = {
          db: { provider: 'sqlite' },
          lists: {
            RateLimit: {
              fields: { key: text() },
              db: {
                indexes: [{ fields: ['key'], unique: true, name: 'RateLimit_key_key' }],
              },
            },
          },
        }

        const schema = generatePrismaSchema(config)

        expect(schema).toContain('@@unique([key], map: "RateLimit_key_key")')
      })

      it('emits a bare @@unique for a single-field entry with unique and no name', () => {
        const config: OpenSaasConfig = {
          db: { provider: 'sqlite' },
          lists: {
            RateLimit: {
              fields: { key: text() },
              db: { indexes: [{ fields: ['key'], unique: true }] },
            },
          },
        }

        const schema = generatePrismaSchema(config)

        expect(schema).toContain('@@unique([key])')
      })

      it('emits @@index for a single-field entry with unique absent', () => {
        const config: OpenSaasConfig = {
          db: { provider: 'sqlite' },
          lists: {
            Post: {
              fields: { slug: text() },
              db: { indexes: [{ fields: ['slug'] }] },
            },
          },
        }

        const schema = generatePrismaSchema(config)

        expect(schema).toContain('@@index([slug])')
        expect(schema).not.toContain('@@unique([slug])')
      })

      it('emits a sort direction on a single-field entry', () => {
        const config: OpenSaasConfig = {
          db: { provider: 'sqlite' },
          lists: {
            Post: {
              fields: { createdAt: timestamp() },
              db: { indexes: [{ fields: [{ field: 'createdAt', sort: 'desc' }] }] },
            },
          },
        }

        const schema = generatePrismaSchema(config)

        expect(schema).toContain('@@index([createdAt(sort: Desc)])')
      })

      it("resolves a relationship field's foreign-key column through a single-field entry, same as the composite case", () => {
        const config: OpenSaasConfig = {
          db: { provider: 'sqlite' },
          lists: {
            User: { fields: { name: text() } },
            Post: {
              fields: {
                title: text(),
                // Field-level isIndexed disabled: db.indexes owns this column.
                author: relationship({ ref: 'User', isIndexed: false }),
              },
              db: {
                indexes: [{ fields: ['author'], unique: true, name: 'Post_authorId_key' }],
              },
            },
          },
        }

        const schema = generatePrismaSchema(config)

        expect(schema).toContain('@@unique([authorId], map: "Post_authorId_key")')
      })
    })

    it('throws naming the list and entry for an empty fields array', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: { title: text() },
            db: { indexes: [{ fields: [] }] },
          },
        },
      }

      expect(() => generatePrismaSchema(config)).toThrow(
        /db\.indexes\[0\].*on list "Post".*empty "fields" array/,
      )
    })

    it('throws naming the field, its isIndexed, and the entry when a single-field entry collides with a unique field-level isIndexed', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          RateLimit: {
            fields: { key: text({ isIndexed: 'unique' }) },
            db: { indexes: [{ fields: ['key'], unique: true, name: 'RateLimit_key_key' }] },
          },
        },
      }

      expect(() => generatePrismaSchema(config)).toThrow(
        /db\.indexes\[0\].*on list "RateLimit".*field "key".*isIndexed: 'unique'/,
      )
    })

    it('throws when a single-field entry collides with a plain (true) field-level isIndexed', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: { slug: text({ isIndexed: true }) },
            db: { indexes: [{ fields: ['slug'] }] },
          },
        },
      }

      expect(() => generatePrismaSchema(config)).toThrow(
        /db\.indexes\[0\].*on list "Post".*field "slug".*isIndexed: true/,
      )
    })

    it("throws when a single-field entry collides with a relationship field's default (true) foreign-key index", () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          User: { fields: { name: text() } },
          Post: {
            fields: {
              title: text(),
              author: relationship({ ref: 'User' }), // isIndexed defaults to true for FKs
            },
            db: { indexes: [{ fields: ['author'] }] },
          },
        },
      }

      expect(() => generatePrismaSchema(config)).toThrow(
        /db\.indexes\[0\].*on list "Post".*field "author".*isIndexed: true/,
      )
    })

    it('does not flag a collision when the single-field entry and a field-level isIndexed target different columns', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: {
              slug: text({ isIndexed: 'unique' }),
              category: text(),
            },
            db: { indexes: [{ fields: ['category'] }] },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('@unique')
      expect(schema).toContain('@@index([category])')
    })

    it('generates byte-for-byte identical model output when no indexes are declared, matching pre-feature behaviour', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: {
              title: text(),
              author: relationship({ ref: 'User' }),
            },
          },
          User: {
            fields: { name: text() },
          },
        },
      }

      const schema = generatePrismaSchema(config)
      expect(schema).toMatchSnapshot()
    })

    it('should generate @@map for a list-level db.map', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
        },
        lists: {
          AuthUser: {
            fields: {
              name: text(),
            },
            db: { map: 'AuthUser' },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('model AuthUser {')
      expect(schema).toContain('@@map("AuthUser")')
    })

    it('should not generate @@map when no list-level db.map is set', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).not.toContain('@@map')
    })

    it('should generate @@schema for a list-level db.schema', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
          schemas: ['public', 'auth'],
        },
        lists: {
          AuthUser: {
            fields: {
              name: text(),
            },
            db: { schema: 'auth' },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('@@schema("auth")')
    })

    it('should enable multiSchema preview feature and datasource schemas array', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
          schemas: ['public', 'auth'],
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
            db: { schema: 'public' },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('previewFeatures     = ["multiSchema"]')
      expect(schema).toContain('schemas  = ["public", "auth"]')
    })

    it('should default importFileExtension="ts" and moduleFormat="esm" in the generator block', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Defaults make the prisma-client subtree statically resolvable (ADR-0008)
      expect(schema).toContain('importFileExtension = "ts"')
      expect(schema).toContain('moduleFormat        = "esm"')
    })

    it('should honour db.prismaGeneratorOptions overrides for the generator block', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
          prismaGeneratorOptions: {
            importFileExtension: 'js',
            moduleFormat: 'commonjs',
          },
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // User-supplied values win over the ts/esm defaults
      expect(schema).toContain('importFileExtension = "js"')
      expect(schema).toContain('moduleFormat        = "commonjs"')
      expect(schema).not.toContain('importFileExtension = "ts"')
      expect(schema).not.toContain('moduleFormat        = "esm"')
    })

    it('should fall back to defaults for any omitted prismaGeneratorOptions key', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // Only override the extension; moduleFormat falls back to the default
          prismaGeneratorOptions: {
            importFileExtension: 'js',
          },
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('importFileExtension = "js"')
      expect(schema).toContain('moduleFormat        = "esm"')
    })

    it('should emit multiSchema previewFeatures alongside the new generator options', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
          schemas: ['public', 'auth'],
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
            db: { schema: 'public' },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // The new options coexist with the preserved multiSchema preview feature
      expect(schema).toContain('importFileExtension = "ts"')
      expect(schema).toContain('moduleFormat        = "esm"')
      expect(schema).toContain('previewFeatures     = ["multiSchema"]')
      expect(schema).toContain('schemas  = ["public", "auth"]')
    })

    it('should emit @@map and @@schema together for an adopted auth table', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
          schemas: ['public', 'auth'],
        },
        lists: {
          AuthUser: {
            fields: {
              name: text(),
            },
            db: { map: 'AuthUser', schema: 'auth' },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('@@map("AuthUser")')
      expect(schema).toContain('@@schema("auth")')
    })

    it('should not enable multiSchema or emit @@schema when no schemas are configured (greenfield default unchanged)', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).not.toContain('previewFeatures')
      expect(schema).not.toContain('multiSchema')
      expect(schema).not.toContain('schemas')
      expect(schema).not.toContain('@@schema')
    })

    it('defaults un-schemad models to @@schema("public") in multi-schema mode (mix of schemad and un-schemad lists)', () => {
      // In multi-schema mode (db.schemas set) Prisma requires every model to
      // declare an @@schema or it errors with P1012. A list WITH db.schema uses
      // its own schema; a list WITHOUT db.schema must default to "public"
      // (mirroring the enum default from #504). See issue #513.
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
          schemas: ['public', 'auth'],
        },
        lists: {
          // Explicit schema → used as-is
          AuthUser: {
            fields: {
              name: text(),
            },
            db: { schema: 'auth' },
          },
          // No db.schema → must default to public (P1012 footgun)
          Post: {
            fields: {
              title: text(),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // The schema'd list keeps its own schema
      const authUserBlock = schema.slice(
        schema.indexOf('model AuthUser {'),
        schema.indexOf('model Post {'),
      )
      expect(authUserBlock).toContain('@@schema("auth")')

      // The un-schema'd list defaults to public
      const postBlock = schema.slice(schema.indexOf('model Post {'))
      expect(postBlock).toContain('@@schema("public")')

      // Every model carries an @@schema — no model is left without one (no P1012)
      const modelCount = schema.match(/^model \w+ \{/gm)?.length ?? 0
      const modelSchemaCount = schema.match(/^\s*@@schema\(/gm)?.length ?? 0
      expect(modelCount).toBe(2)
      expect(modelSchemaCount).toBe(modelCount)
    })

    it('emits no @@schema on models in greenfield mode (no db.schemas)', () => {
      // Greenfield output must be unchanged: a plain list with no db.schemas
      // configured emits no @@schema on its model.
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
        },
        lists: {
          Post: {
            fields: {
              title: text(),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('model Post {')
      expect(schema).not.toContain('@@schema')
    })

    it('models an existing auth-schema better-auth install so it diffs clean (adoption)', () => {
      // Mirrors what authPlugin({ schema: 'auth', user: { modelName: 'AuthUser' }, ... })
      // produces after init + beforeGenerate: custom list keys pinned to their
      // live table names (@@map), placed in the `auth` schema (@@schema), with the
      // app's own `public.User` left alone. Generating this models the existing
      // tables for runtime/types without introducing any new/renamed tables — a
      // clean diff against the live database.
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
          schemas: ['public', 'auth'],
        },
        lists: {
          // App's own domain User stays in public
          User: {
            fields: {
              subjectId: text({ validation: { isRequired: true } }),
            },
            db: { schema: 'public' },
          },
          AuthUser: {
            fields: {
              name: text({ validation: { isRequired: true } }),
              email: text({ validation: { isRequired: true }, isIndexed: 'unique' }),
              sessions: relationship({ ref: 'AuthSession.user', many: true }),
            },
            db: { map: 'AuthUser', schema: 'auth' },
          },
          AuthSession: {
            fields: {
              token: text({ validation: { isRequired: true }, isIndexed: 'unique' }),
              user: relationship({
                ref: 'AuthUser.sessions',
                db: { foreignKey: { map: 'user_id' } },
              }),
            },
            db: { map: 'AuthSession', schema: 'auth' },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Multi-schema datasource is valid: preview feature + schemas array
      expect(schema).toContain('previewFeatures     = ["multiSchema"]')
      expect(schema).toContain('schemas  = ["public", "auth"]')

      // Auth models pinned to their live table names, in the auth schema
      expect(schema).toContain('model AuthUser {')
      expect(schema).toContain('@@map("AuthUser")')
      expect(schema).toContain('model AuthSession {')
      expect(schema).toContain('@@map("AuthSession")')

      // App User stays in public, untouched
      expect(schema).toContain('model User {')

      // Every model carries an @@schema (Prisma multi-schema requirement) and the
      // auth models are placed in `auth`, the app User in `public`.
      const authUserBlock = schema.slice(schema.indexOf('model AuthUser {'))
      expect(authUserBlock).toContain('@@schema("auth")')

      // The session FK column matches the live column name (adoption)
      expect(schema).toContain('@map("user_id")')
    })

    it('should generate indexes for multiple foreign keys', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
          Category: {
            fields: {
              name: text(),
            },
          },
          Post: {
            fields: {
              title: text(),
              author: relationship({ ref: 'User' }),
              category: relationship({ ref: 'Category' }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Should have both foreign keys
      expect(schema).toContain('authorId     String?')
      expect(schema).toContain('categoryId   String?')
      // Should have indexes for both
      expect(schema).toContain('@@index([authorId])')
      expect(schema).toContain('@@index([categoryId])')
    })

    it('should work with bidirectional relationships', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
              posts: relationship({ ref: 'Post.author', many: true }),
            },
          },
          Post: {
            fields: {
              title: text(),
              author: relationship({ ref: 'User.posts' }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Post should have foreign key and index
      expect(schema).toContain('authorId     String?')
      expect(schema).toContain('@@index([authorId])')
    })

    it('should generate implicit many-to-many join table with Prisma naming (default)', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Lesson: {
            fields: {
              title: text(),
              teachers: relationship({ ref: 'Teacher.lessons', many: true }),
            },
          },
          Teacher: {
            fields: {
              name: text(),
              lessons: relationship({ ref: 'Lesson.teachers', many: true }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Should use implicit many-to-many (no explicit join table model)
      expect(schema).toContain('teachers     Teacher[]')
      expect(schema).toContain('lessons      Lesson[]')
      // Should NOT have explicit join table model
      expect(schema).not.toContain('model LessonTeachers')
      expect(schema).not.toContain('@@map("_Lesson_teachers")')
    })

    it('should generate many-to-many relationships with Keystone naming', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          joinTableNaming: 'keystone',
        },
        lists: {
          Lesson: {
            fields: {
              title: text(),
              teachers: relationship({ ref: 'Teacher.lessons', many: true }),
            },
          },
          Teacher: {
            fields: {
              name: text(),
              lessons: relationship({ ref: 'Lesson.teachers', many: true }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Should use named relation (Prisma creates implicit join table _Lesson_teachers)
      expect(schema).toContain('teachers     Teacher[]  @relation("Lesson_teachers")')
      expect(schema).toContain('lessons      Lesson[]  @relation("Lesson_teachers")')
    })

    it('should generate multiple many-to-many relationships with Keystone naming', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
          joinTableNaming: 'keystone',
        },
        lists: {
          Lesson: {
            fields: {
              title: text(),
              teachers: relationship({ ref: 'Teacher.lessons', many: true }),
              instruments: relationship({ ref: 'Instrument.lessons', many: true }),
            },
          },
          Teacher: {
            fields: {
              name: text(),
              lessons: relationship({ ref: 'Lesson.teachers', many: true }),
            },
          },
          Instrument: {
            fields: {
              name: text(),
              lessons: relationship({ ref: 'Lesson.instruments', many: true }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Relationships should use named relations (Prisma creates implicit join tables)
      expect(schema).toContain('teachers     Teacher[]  @relation("Lesson_teachers")')
      expect(schema).toContain('instruments  Instrument[]  @relation("Instrument_lessons")')
    })

    it('should use deterministic naming for bidirectional many-to-many', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          joinTableNaming: 'keystone',
        },
        lists: {
          Tag: {
            fields: {
              name: text(),
              posts: relationship({ ref: 'Post.tags', many: true }),
            },
          },
          Post: {
            fields: {
              title: text(),
              tags: relationship({ ref: 'Tag.posts', many: true }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Should pick one side deterministically (alphabetically)
      // Post.tags < Tag.posts, so should use Post_tags relation name
      // Prisma will create implicit join table _Post_tags
      expect(schema).toContain('@relation("Post_tags")')
    })

    it('should handle list-only many-to-many with Keystone naming', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          joinTableNaming: 'keystone',
        },
        lists: {
          Tag: {
            fields: {
              name: text(),
            },
          },
          Post: {
            fields: {
              title: text(),
              tags: relationship({ ref: 'Tag', many: true }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Should use named relation (Prisma creates implicit join table _Post_tags)
      expect(schema).toContain('@relation("Post_tags")')
    })

    it('should generate synthetic fields for list-only many-to-many with Keystone naming', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          joinTableNaming: 'keystone',
        },
        lists: {
          Tag: {
            fields: {
              name: text(),
            },
          },
          Post: {
            fields: {
              title: text(),
              tags: relationship({ ref: 'Tag', many: true }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Post should have the relationship field with Keystone relation name
      expect(schema).toContain('tags         Tag[]  @relation("Post_tags")')

      // Tag MUST have a synthetic back-reference field — Prisma requires both sides
      // of an implicit many-to-many relationship to be explicitly defined
      expect(schema).toContain('from_Post_tags Post[]  @relation("Post_tags")')
    })

    it('should generate synthetic fields for one-sided many-to-one with Keystone naming', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
          joinTableNaming: 'keystone',
        },
        lists: {
          Term: {
            fields: {
              name: text(),
            },
          },
          Bill: {
            fields: {
              title: text(),
              term: relationship({ ref: 'Term' }), // One-sided many-to-one
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Bill should have foreign key and relation
      expect(schema).toContain('termId       String?')
      expect(schema).toContain('term         Term?')
      expect(schema).toContain('@relation("Bill_term"')

      // Term should have synthetic back-reference field
      expect(schema).toContain('from_Bill_term Bill[]')
      expect(schema).toContain('@relation("Bill_term")')
    })

    it('should generate synthetic fields for self-referential one-sided with Keystone naming', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
          joinTableNaming: 'keystone',
        },
        lists: {
          Term: {
            fields: {
              name: text(),
              copyFrom: relationship({ ref: 'Term' }), // Self-referential, one-sided
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Term should have foreign key and relation
      expect(schema).toContain('copyFromId   String?')
      expect(schema).toContain('copyFrom     Term?')
      expect(schema).toContain('@relation("Term_copyFrom"')

      // Term should also have synthetic back-reference field
      expect(schema).toContain('from_Term_copyFrom Term[]')
      expect(schema).toContain('@relation("Term_copyFrom")')
    })

    it('should use per-field relationName when specified on one side', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Lesson: {
            fields: {
              title: text(),
              teachers: relationship({
                ref: 'Teacher.lessons',
                many: true,
                db: { relationName: 'Lesson_teachers' },
              }),
            },
          },
          Teacher: {
            fields: {
              name: text(),
              lessons: relationship({ ref: 'Lesson.teachers', many: true }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Should use the per-field relationName from Lesson.teachers
      expect(schema).toContain('teachers     Teacher[]  @relation("Lesson_teachers")')
      expect(schema).toContain('lessons      Lesson[]  @relation("Lesson_teachers")')
    })

    it('should validate matching relationNames on both sides', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Lesson: {
            fields: {
              teachers: relationship({
                ref: 'Teacher.lessons',
                many: true,
                db: { relationName: 'Lesson_teachers' },
              }),
            },
          },
          Teacher: {
            fields: {
              lessons: relationship({
                ref: 'Lesson.teachers',
                many: true,
                db: { relationName: 'Teacher_lessons' }, // Mismatched!
              }),
            },
          },
        },
      }

      expect(() => generatePrismaSchema(config)).toThrow(
        'Relation name mismatch: Lesson.teachers has relationName "Lesson_teachers" but Teacher.lessons has "Teacher_lessons"',
      )
    })

    it('should allow matching relationNames on both sides', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Lesson: {
            fields: {
              teachers: relationship({
                ref: 'Teacher.lessons',
                many: true,
                db: { relationName: 'CustomRelation' },
              }),
            },
          },
          Teacher: {
            fields: {
              lessons: relationship({
                ref: 'Lesson.teachers',
                many: true,
                db: { relationName: 'CustomRelation' },
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('teachers     Teacher[]  @relation("CustomRelation")')
      expect(schema).toContain('lessons      Lesson[]  @relation("CustomRelation")')
    })

    it('should prioritize per-field relationName over global joinTableNaming', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          joinTableNaming: 'keystone',
        },
        lists: {
          Lesson: {
            fields: {
              teachers: relationship({
                ref: 'Teacher.lessons',
                many: true,
                db: { relationName: 'CustomRelation' },
              }),
              students: relationship({ ref: 'Student.lessons', many: true }),
            },
          },
          Teacher: {
            fields: {
              lessons: relationship({ ref: 'Lesson.teachers', many: true }),
            },
          },
          Student: {
            fields: {
              lessons: relationship({ ref: 'Lesson.students', many: true }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // teachers should use per-field relationName
      expect(schema).toContain('teachers     Teacher[]  @relation("CustomRelation")')
      // students should use global Keystone naming
      expect(schema).toContain('students     Student[]  @relation("Lesson_students")')
    })

    it('should handle list-only many-to-many with per-field relationName', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Tag: {
            fields: {
              name: text(),
            },
          },
          Post: {
            fields: {
              title: text(),
              tags: relationship({
                ref: 'Tag',
                many: true,
                db: { relationName: 'Post_tags' },
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Should use per-field relationName on the source side
      expect(schema).toContain('tags         Tag[]  @relation("Post_tags")')

      // Tag MUST have a synthetic back-reference using the same explicit relation name
      // Prisma requires both sides of implicit many-to-many to be defined
      expect(schema).toContain('from_Post_tags Post[]  @relation("Post_tags")')
    })
  })

  describe('select field with enum type', () => {
    it('should generate enum block and use enum type for enum select field', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: {
              title: text(),
              status: select({
                options: [
                  { label: 'Draft', value: 'draft' },
                  { label: 'Published', value: 'published' },
                ],
                db: { type: 'enum' },
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Should generate enum block
      expect(schema).toContain('enum PostStatus {')
      expect(schema).toContain('  draft')
      expect(schema).toContain('  published')
      // Should use enum type in model
      expect(schema).toContain('PostStatus')
      // Should NOT use String type for this field
      expect(schema).not.toMatch(/status\s+String/)
    })

    it('should use unquoted default value for enum select field', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: {
              title: text(),
              status: select({
                options: [
                  { label: 'Draft', value: 'draft' },
                  { label: 'Published', value: 'published' },
                ],
                db: { type: 'enum' },
                defaultValue: 'draft',
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Default value should be unquoted (Prisma enum syntax)
      expect(schema).toContain('@default(draft)')
      // Should NOT have quoted default (that would be string syntax)
      expect(schema).not.toContain('@default("draft")')
    })

    it('should add ? modifier for optional enum select field', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: {
              status: select({
                options: [
                  { label: 'Draft', value: 'draft' },
                  { label: 'Published', value: 'published' },
                ],
                db: { type: 'enum' },
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Optional field should have ?
      expect(schema).toContain('PostStatus?')
    })

    it('should not add ? modifier for required enum select field', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: {
              status: select({
                options: [
                  { label: 'Draft', value: 'draft' },
                  { label: 'Published', value: 'published' },
                ],
                db: { type: 'enum' },
                validation: { isRequired: true },
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Required field should NOT have ?
      expect(schema).not.toContain('PostStatus?')
      expect(schema).toContain('PostStatus')
    })

    it('should generate separate enum blocks for different lists with same field name', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: {
              status: select({
                options: [
                  { label: 'Draft', value: 'draft' },
                  { label: 'Published', value: 'published' },
                ],
                db: { type: 'enum' },
              }),
            },
          },
          Comment: {
            fields: {
              status: select({
                options: [
                  { label: 'Pending', value: 'pending' },
                  { label: 'Approved', value: 'approved' },
                ],
                db: { type: 'enum' },
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Should generate separate enum blocks for each list
      expect(schema).toContain('enum PostStatus {')
      expect(schema).toContain('enum CommentStatus {')
      expect(schema).toContain('  draft')
      expect(schema).toContain('  published')
      expect(schema).toContain('  pending')
      expect(schema).toContain('  approved')
    })

    it('should generate separate enum blocks for multiple enum fields on same list', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: {
              status: select({
                options: [
                  { label: 'Draft', value: 'draft' },
                  { label: 'Published', value: 'published' },
                ],
                db: { type: 'enum' },
              }),
              type: select({
                options: [
                  { label: 'Article', value: 'article' },
                  { label: 'Video', value: 'video' },
                ],
                db: { type: 'enum' },
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Should generate separate enum blocks for each field
      expect(schema).toContain('enum PostStatus {')
      expect(schema).toContain('enum PostType {')
    })

    it('should generate string select field as String type (no enum)', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: {
              status: select({
                options: [
                  { label: 'Draft', value: 'draft' },
                  { label: 'Published', value: 'published' },
                ],
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Default (string type) should use String
      expect(schema).toContain('String')
      // Should NOT generate an enum block
      expect(schema).not.toContain('enum PostStatus')
    })

    it('should throw for enum values that are not valid Prisma identifiers', () => {
      expect(() => {
        select({
          options: [
            { label: 'In Progress', value: 'in-progress' },
            { label: 'Done', value: 'done' },
          ],
          db: { type: 'enum' },
        })
      }).toThrow(/valid Prisma identifiers/)
    })

    it('should throw for enum values starting with a number', () => {
      expect(() => {
        select({
          options: [{ label: 'First', value: '1st' }],
          db: { type: 'enum' },
        })
      }).toThrow(/valid Prisma identifiers/)
    })

    it('should accept enum values with underscores', () => {
      expect(() => {
        select({
          options: [
            { label: 'In Progress', value: 'in_progress' },
            { label: 'Done', value: 'done' },
          ],
          db: { type: 'enum' },
        })
      }).not.toThrow()
    })

    it('should rename the enum block and the column reference with db.enumName', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          AccountNote: {
            fields: {
              status: select({
                options: [
                  { label: 'Open', value: 'open' },
                  { label: 'Closed', value: 'closed' },
                ],
                db: { type: 'enum', enumName: 'AccountNoteStatusType' },
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // The enum block uses the custom name
      expect(schema).toContain('enum AccountNoteStatusType {')
      expect(schema).toContain('  open')
      expect(schema).toContain('  closed')
      // The column references the custom enum name
      expect(schema).toMatch(/status\s+AccountNoteStatusType/)
      // The derived name is not emitted anywhere
      expect(schema).not.toContain('enum AccountNoteStatus {')
      expect(schema).not.toMatch(/status\s+AccountNoteStatus\b/)
    })

    it('should emit String? @default("X") for optional string select with default + db.isNullable', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: {
              status: select({
                options: [
                  { label: 'Draft', value: 'draft' },
                  { label: 'Published', value: 'published' },
                ],
                defaultValue: 'draft',
                db: { isNullable: true },
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toMatch(/status\s+String\? @default\("draft"\)/)
    })

    it('should emit <Enum>? @default(X) for optional enum select with default + db.isNullable', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: {
              status: select({
                options: [
                  { label: 'Draft', value: 'draft' },
                  { label: 'Published', value: 'published' },
                ],
                defaultValue: 'draft',
                db: { type: 'enum', isNullable: true },
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('enum PostStatus {')
      expect(schema).toMatch(/status\s+PostStatus\? @default\(draft\)/)
    })

    it('should keep optional-select-with-default NOT NULL without db.isNullable (string)', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: {
              status: select({
                options: [
                  { label: 'Draft', value: 'draft' },
                  { label: 'Published', value: 'published' },
                ],
                defaultValue: 'draft',
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Unchanged behaviour: a default makes the column NOT NULL
      expect(schema).toMatch(/status\s+String @default\("draft"\)/)
      expect(schema).not.toMatch(/status\s+String\?/)
    })

    it('should keep optional-select-with-default NOT NULL without db.isNullable (enum)', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: {
              status: select({
                options: [
                  { label: 'Draft', value: 'draft' },
                  { label: 'Published', value: 'published' },
                ],
                defaultValue: 'draft',
                db: { type: 'enum' },
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toMatch(/status\s+PostStatus @default\(draft\)/)
      expect(schema).not.toMatch(/status\s+PostStatus\?/)
    })

    it('should generate enum field with @map modifier', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: {
              status: select({
                options: [
                  { label: 'Draft', value: 'draft' },
                  { label: 'Published', value: 'published' },
                ],
                db: { type: 'enum', map: 'post_status' },
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('@map("post_status")')
      expect(schema).toContain('enum PostStatus {')
    })

    it('should declare @@schema on generated enum blocks in multi-schema mode (P1012 fix)', () => {
      // Multi-schema mode (db.schemas) requires every model AND every enum to
      // declare an @@schema, or Prisma rejects the schema with P1012. Before this
      // fix only models carried @@schema, so a db.schemas + enum-select config
      // produced an invalid schema.
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
          schemas: ['public', 'auth'],
        },
        lists: {
          Post: {
            fields: {
              title: text(),
              status: select({
                options: [
                  { label: 'Draft', value: 'draft' },
                  { label: 'Published', value: 'published' },
                ],
                db: { type: 'enum' },
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Datasource is multi-schema
      expect(schema).toContain('previewFeatures     = ["multiSchema"]')
      expect(schema).toContain('schemas  = ["public", "auth"]')

      // The enum block exists and carries @@schema (default public — the list
      // declares no schema of its own). This is the fix: previously the enum had
      // no @@schema, which Prisma rejects with P1012 in multi-schema mode.
      const enumBlock = schema.slice(
        schema.indexOf('enum PostStatus {'),
        schema.indexOf('}', schema.indexOf('enum PostStatus {')) + 1,
      )
      expect(enumBlock).toContain('@@schema("public")')
    })

    it('should place an enum in its owning model schema (enum inherits list db.schema)', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
          schemas: ['public', 'auth'],
        },
        lists: {
          AuthUser: {
            fields: {
              name: text(),
              role: select({
                options: [
                  { label: 'Admin', value: 'admin' },
                  { label: 'Member', value: 'member' },
                ],
                db: { type: 'enum' },
              }),
            },
            db: { schema: 'auth' },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // The enum follows its owning model into the `auth` schema, not `public`.
      const enumBlock = schema.slice(
        schema.indexOf('enum AuthUserRole {'),
        schema.indexOf('}', schema.indexOf('enum AuthUserRole {')) + 1,
      )
      expect(enumBlock).toContain('@@schema("auth")')
    })

    it('should NOT add @@schema to enum blocks in greenfield mode (no db.schemas)', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql' },
        lists: {
          Post: {
            fields: {
              status: select({
                options: [
                  { label: 'Draft', value: 'draft' },
                  { label: 'Published', value: 'published' },
                ],
                db: { type: 'enum' },
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Enum block is generated...
      expect(schema).toContain('enum PostStatus {')
      // ...but greenfield output is unchanged — no @@schema anywhere.
      expect(schema).not.toContain('@@schema')
    })

    it('should match snapshot for enum select field', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Post: {
            fields: {
              title: text({ validation: { isRequired: true } }),
              status: select({
                options: [
                  { label: 'Draft', value: 'draft' },
                  { label: 'Published', value: 'published' },
                  { label: 'Archived', value: 'archived' },
                ],
                db: { type: 'enum' },
                defaultValue: 'draft',
              }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)
      expect(schema).toMatchSnapshot()
    })

    it('should generate singleton model with bare Int @id (no @default)', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Settings: {
            fields: {
              siteName: text({ validation: { isRequired: true } }),
              maintenanceMode: checkbox({ defaultValue: false }),
            },
            isSingleton: true,
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Singleton ids are bare `id Int @id` to match Keystone 6 (see ADR-0004),
      // which emits no column default for singleton ids.
      expect(schema).toContain('id        Int      @id\n')
      expect(schema).not.toContain('@default(1)')
      expect(schema).not.toContain('id        String   @id @default(cuid())')
      expect(schema).toMatchSnapshot()
    })

    it('should generate regular model with String @id @default(cuid())', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Post: {
            fields: {
              title: text(),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Non-singleton ids are unaffected by the singleton bare-id change.
      expect(schema).toContain('id        String   @id @default(cuid())')
      expect(schema).not.toContain('id        Int      @id')
    })
  })

  describe('field defaultValue → @default(...)', () => {
    it('emits a bare numeric @default for integer fields', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Widget: {
            fields: {
              quota: integer({ defaultValue: 3550 }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toMatch(/quota\s+Int\?\s+@default\(3550\)/)
      expect(schema).not.toContain('@default("3550")')
    })

    it('keeps the nullable ? independent of the integer default', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Widget: {
            fields: {
              // Required → non-nullable, but still carries a default
              required: integer({ validation: { isRequired: true }, defaultValue: 1 }),
              // Optional → nullable, also carries a default
              optional: integer({ defaultValue: 2 }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // Required keeps no `?` but still gets @default
      expect(schema).toMatch(/required\s+Int\s+@default\(1\)/)
      // Optional keeps its `?` and gets @default
      expect(schema).toMatch(/optional\s+Int\?\s+@default\(2\)/)
    })

    it('emits a quoted string @default for text fields', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Account: {
            fields: {
              status: text({ defaultValue: 'PLEASE_UPDATE' }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('@default("PLEASE_UPDATE")')
    })

    it('emits Keystone JSON-literal @default for json array fields', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Setting: {
            fields: {
              numbers: json({ defaultValue: [1, 2, 3, 4, 5] }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toMatch(/numbers\s+Json\?\s+@default\("\[1,2,3,4,5\]"\)/)
    })

    it('emits @default("[]") for an empty json array default', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Setting: {
            fields: {
              tags: json({ defaultValue: [] }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('@default("[]")')
    })

    it('emits @default("{}") for an empty json object default', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Setting: {
            fields: {
              meta: json({ defaultValue: {} }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toContain('@default("{}")')
    })

    it('emits no @default for fields without a defaultValue', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Plain: {
            fields: {
              name: text(),
              count: integer(),
              data: json(),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      // None of these scalar fields should carry a @default(...)
      expect(schema).toMatch(/name\s+String\?\s*$/m)
      expect(schema).toMatch(/count\s+Int\?\s*$/m)
      expect(schema).toMatch(/data\s+Json\?\s*$/m)
      expect(schema).not.toContain('@default("')
      // Only the system-field defaults (id/createdAt/updatedAt) remain
      expect(schema).not.toMatch(/name\s+String\?\s+@default/)
      expect(schema).not.toMatch(/count\s+Int\?\s+@default/)
      expect(schema).not.toMatch(/data\s+Json\?\s+@default/)
    })

    it('generates a representative multi-field model with mixed defaults', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'sqlite' },
        lists: {
          Config: {
            fields: {
              label: text({ defaultValue: 'PLEASE_UPDATE' }),
              retries: integer({ defaultValue: 3 }),
              limits: json({ defaultValue: [1, 2, 3, 4, 5] }),
              empty: json({ defaultValue: [] }),
            },
          },
        },
      }

      const schema = generatePrismaSchema(config)

      expect(schema).toMatchSnapshot()
    })
  })

  describe('Keystone-compat mode (db.keystoneCompat)', () => {
    // A representative model exercising every branch of the empty-string rule:
    // required text (compat default applies), required text with an explicit
    // default (explicit wins), optional/nullable text (untouched), and non-text
    // fields (untouched). The same lists are generated with the flag off below
    // so the on/off contrast is part of the proof.
    const representativeLists: OpenSaasConfig['lists'] = {
      Account: {
        fields: {
          // Required, no default → @default("") under keystoneCompat
          name: text({ validation: { isRequired: true } }),
          // Required, explicit default → explicit value wins
          status: text({ validation: { isRequired: true }, defaultValue: 'PLEASE_UPDATE' }),
          // Optional → nullable → never gets the compat default
          nickname: text(),
          // Explicitly nullable despite isRequired → never gets the compat default
          note: text({ validation: { isRequired: true }, db: { isNullable: true } }),
          // Non-text fields are unaffected by the flag
          loginCount: integer({ validation: { isRequired: true } }),
          isActive: checkbox({ defaultValue: true }),
        },
      },
    }

    it('emits @default("") for non-null text without an explicit default (snapshot)', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql', keystoneCompat: true },
        lists: representativeLists,
      }

      const schema = generatePrismaSchema(config)

      // The migrating-developer guarantee: required text reaches Schema parity
      // with Keystone's implicit empty-string default.
      expect(schema).toMatch(/name\s+String\s+@default\(""\)/)
      // Explicit default still wins over the compat empty-string default.
      expect(schema).toMatch(/status\s+String\s+@default\("PLEASE_UPDATE"\)/)
      // Nullable text is untouched (no default at all).
      expect(schema).toMatch(/nickname\s+String\?\s*$/m)
      expect(schema).toMatch(/note\s+String\?\s*$/m)
      // Non-text fields keep their own behaviour.
      expect(schema).toMatch(/loginCount\s+Int\s*$/m)
      expect(schema).toMatch(/isActive\s+Boolean\s+@default\(true\)/)

      expect(schema).toMatchSnapshot()
    })

    it('emits no implicit text default when keystoneCompat is off (default)', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql' },
        lists: representativeLists,
      }

      const schema = generatePrismaSchema(config)

      // Greenfield default: required text stays clean — String with no default.
      expect(schema).toMatch(/name\s+String\s*$/m)
      expect(schema).not.toMatch(/name\s+String\s+@default/)
      // Explicit defaults are still honoured regardless of the flag.
      expect(schema).toMatch(/status\s+String\s+@default\("PLEASE_UPDATE"\)/)
      // The only empty-string default present is the explicit none — i.e. there
      // is no @default("") anywhere when the flag is off.
      expect(schema).not.toContain('@default("")')
    })
  })
})

describe('resolveListTimestamps', () => {
  // Minimal builders. The predicate only reads `db` and the keys of `fields`, so a
  // structurally-minimal list/db is sufficient and keeps these tests focused.
  const dbWith = (timestamps?: boolean): DatabaseConfig => ({
    provider: 'sqlite',
    timestamps,
    prismaClientConstructor: (PrismaClientClass) => new PrismaClientClass(),
  })

  const listWith = (
    fields: ListConfig<TypeInfo>['fields'],
    timestamps?: boolean,
  ): ListConfig<TypeInfo> => ({
    fields,
    db: timestamps === undefined ? undefined : { timestamps },
  })

  it('is off by default (no global, no per-list)', () => {
    expect(resolveListTimestamps(listWith({ name: text() }), dbWith())).toEqual({
      createdAt: false,
      updatedAt: false,
    })
  })

  it('is on for every list when the global flag is true', () => {
    expect(resolveListTimestamps(listWith({ name: text() }), dbWith(true))).toEqual({
      createdAt: true,
      updatedAt: true,
    })
  })

  it('per-list false overrides global true', () => {
    expect(resolveListTimestamps(listWith({ name: text() }, false), dbWith(true))).toEqual({
      createdAt: false,
      updatedAt: false,
    })
  })

  it('per-list true overrides global off', () => {
    expect(resolveListTimestamps(listWith({ name: text() }, true), dbWith())).toEqual({
      createdAt: true,
      updatedAt: true,
    })
  })

  it('skips a declared createdAt when enabled (no duplicate)', () => {
    expect(resolveListTimestamps(listWith({ createdAt: timestamp() }, true), dbWith())).toEqual({
      createdAt: false,
      updatedAt: true,
    })
  })

  it('skips both declared timestamps when enabled', () => {
    expect(
      resolveListTimestamps(
        listWith({ createdAt: timestamp(), updatedAt: timestamp() }, true),
        dbWith(),
      ),
    ).toEqual({
      createdAt: false,
      updatedAt: false,
    })
  })

  it('does not skip declared timestamps when timestamps are off', () => {
    // When off, declared fields are emitted by the regular field loop, so the
    // predicate reports "no auto column" regardless of what the list declares.
    expect(
      resolveListTimestamps(listWith({ createdAt: timestamp() }, false), dbWith(true)),
    ).toEqual({
      createdAt: false,
      updatedAt: false,
    })
  })
})

describe('Multi-column field emission', () => {
  // A field that emits several physical columns through getPrismaColumns (the
  // contract storage image()/file() use in Keystone-parity mode — see
  // ADR-0006). Built inline so the generator test stays self-contained.
  function multiColumnField(
    columns: Array<{ name: string; type: string; modifiers?: string; map?: string }>,
  ): FieldConfig {
    return {
      type: 'multiColumn',
      getPrismaColumns: () => columns,
      // A multi-column field still reports a logical TS type; the generator does
      // not call getPrismaType when getPrismaColumns returns columns.
      getTypeScriptType: () => ({ type: 'unknown', optional: true }),
    } as unknown as FieldConfig
  }

  it('emits one Prisma line per column with @map names', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite' },
      lists: {
        Teacher: {
          fields: {
            name: text(),
            image: multiColumnField([
              { name: 'image_url', type: 'String', modifiers: '?', map: 'image_url' },
              { name: 'image_width', type: 'Int', modifiers: '?', map: 'image_width' },
              { name: 'image_height', type: 'Int', modifiers: '?', map: 'image_height' },
              { name: 'image_filesize', type: 'Int', modifiers: '?', map: 'image_filesize' },
              {
                name: 'image_contentType',
                type: 'String',
                modifiers: '?',
                map: 'image_contentType',
              },
              {
                name: 'image_contentDisposition',
                type: 'String',
                modifiers: '?',
                map: 'image_contentDisposition',
              },
              { name: 'image_pathname', type: 'String', modifiers: '?', map: 'image_pathname' },
            ]),
          },
        },
      },
    }

    const schema = generatePrismaSchema(config)

    // The single logical field never appears as its own column.
    expect(schema).not.toMatch(/^\s*image\s+Json/m)
    // Seven per-part columns are emitted, each nullable and @map-ped onto its
    // physical Keystone column.
    expect(schema).toContain('image_url    String? @map("image_url")')
    expect(schema).toContain('image_width  Int? @map("image_width")')
    expect(schema).toContain('image_height Int? @map("image_height")')
    expect(schema).toContain('image_filesize Int? @map("image_filesize")')
    expect(schema).toContain('image_contentType String? @map("image_contentType")')
    expect(schema).toContain('image_contentDisposition String? @map("image_contentDisposition")')
    expect(schema).toContain('image_pathname String? @map("image_pathname")')
  })

  it('honours a custom physical column name via the descriptor map', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite' },
      lists: {
        Teacher: {
          fields: {
            avatar: multiColumnField([
              { name: 'avatarUrl', type: 'String', modifiers: '?', map: 'avatar_url' },
            ]),
          },
        },
      },
    }

    const schema = generatePrismaSchema(config)
    expect(schema).toContain('avatarUrl    String? @map("avatar_url")')
  })

  it('emits a plain column line when no map is supplied', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite' },
      lists: {
        Doc: {
          fields: {
            fileUrl: multiColumnField([{ name: 'fileUrl', type: 'String', modifiers: '?' }]),
          },
        },
      },
    }

    const schema = generatePrismaSchema(config)
    expect(schema).toContain('fileUrl      String?')
    expect(schema).not.toContain('@map')
  })

  it('falls back to single-column getPrismaType when getPrismaColumns returns nothing', () => {
    // A field exposing getPrismaColumns that returns undefined must behave
    // exactly like a normal single-column field.
    const field = {
      type: 'maybeMulti',
      getPrismaColumns: () => undefined,
      getPrismaType: () => ({ type: 'String', modifiers: '?' }),
      getTypeScriptType: () => ({ type: 'string', optional: true }),
    } as unknown as FieldConfig

    const config: OpenSaasConfig = {
      db: { provider: 'sqlite' },
      lists: { Thing: { fields: { value: field } } },
    }

    const schema = generatePrismaSchema(config)
    expect(schema).toContain('value        String?')
  })
})
