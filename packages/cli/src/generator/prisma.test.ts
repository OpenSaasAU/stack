import { describe, it, expect } from 'vitest'
import { generatePrismaSchema } from './prisma.js'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import {
  text,
  integer,
  relationship,
  checkbox,
  timestamp,
  select,
  json,
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

    it('should always include system fields', () => {
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
      expect(schema).toContain('createdAt DateTime @default(now())')
      expect(schema).toContain('updatedAt DateTime @default(now()) @updatedAt')
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

    it('should generate singleton model with Int @id @default(1)', () => {
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

      expect(schema).toContain('id        Int      @id @default(1)')
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

      expect(schema).toContain('id        String   @id @default(cuid())')
      expect(schema).not.toContain('id        Int      @id @default(1)')
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
})
