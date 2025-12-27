import { describe, it, expect } from 'vitest'
import { generatePrismaSchema } from './prisma.js'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text, integer, relationship, checkbox, timestamp } from '@opensaas/stack-core/fields'

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
      expect(schema).toContain('updatedAt DateTime @updatedAt')
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

      // Post should have one-to-many with named relation
      expect(schema).toContain('tags         Tag[]  @relation("Post_tags")')

      // Tag should have synthetic field with matching relation name
      expect(schema).toContain('from_Post_tags Post[]  @relation("Post_tags")')
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

    it('should generate explicit many-to-many join table with Keystone naming', () => {
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

      // Should use named relation
      expect(schema).toContain('teachers     Teacher[]  @relation("Lesson_teachers")')
      expect(schema).toContain('lessons      Lesson[]  @relation("Lesson_teachers")')

      // Should have explicit join table model
      expect(schema).toContain('model LessonTeachers {')
      expect(schema).toContain('@@map("_Lesson_teachers")')

      // Join table should have both foreign keys
      expect(schema).toContain('lesson       Lesson')
      expect(schema).toContain('teacher      Teacher')
      expect(schema).toContain('lessonId     String')
      expect(schema).toContain('teacherId    String')

      // Join table should have composite primary key
      expect(schema).toContain('@@id([lessonId, teacherId])')
      expect(schema).toContain('@@index([teacherId])')
    })

    it('should generate multiple explicit join tables with Keystone naming', () => {
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

      // Should have two explicit join table models
      expect(schema).toContain('model InstrumentLessons {')
      expect(schema).toContain('@@map("_Instrument_lessons")')

      expect(schema).toContain('model LessonTeachers {')
      expect(schema).toContain('@@map("_Lesson_teachers")')

      // Relationships should use named relations
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
      // Post.tags < Tag.posts, so should use Post_tags
      expect(schema).toContain('@@map("_Post_tags")')
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

      // Should generate explicit join table for list-only many-to-many
      expect(schema).toContain('model PostTags {')
      expect(schema).toContain('@@map("_Post_tags")')
      expect(schema).toContain('@relation("Post_tags")')
    })

    it('should not generate synthetic fields for list-only many-to-many with Keystone naming', () => {
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

      // Should NOT have synthetic field (handled by explicit join table)
      expect(schema).not.toContain('from_Post_tags')
    })
  })
})
