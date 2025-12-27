---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add Keystone-compatible join table naming for many-to-many relationships

When migrating from KeystoneJS, many-to-many relationship join tables now preserve their original naming convention to prevent data loss. Set `joinTableNaming: 'keystone'` in your database config to use field-location-based naming (e.g., `_Lesson_teachers`) instead of Prisma's default alphabetically-sorted naming (e.g., `_LessonToTeacher`).

**Configuration:**

```typescript
export default config({
  db: {
    provider: 'postgresql',
    joinTableNaming: 'keystone', // Use KeystoneJS naming convention
    prismaClientConstructor: (PrismaClient) => {
      // ... your adapter setup
    },
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
})
```

**Generated Schema:**

With `joinTableNaming: 'keystone'`, the generator creates explicit join table models that map to Keystone's table names:

```prisma
model LessonTeachers {
  lesson     Lesson  @relation("Lesson_teachers", fields: [lessonId], references: [id], onDelete: Cascade)
  lessonId   String
  teacher    Teacher @relation("Lesson_teachers", fields: [teacherId], references: [id], onDelete: Cascade)
  teacherId  String

  @@id([lessonId, teacherId])
  @@index([teacherId])
  @@map("_Lesson_teachers")  // Preserves Keystone naming
}
```

**Migration Guide:**

1. Identify all many-to-many relationships in your Keystone schema
2. Add `joinTableNaming: 'keystone'` to your database config
3. Run `pnpm generate` to create the Prisma schema
4. Verify join table names match your existing database
5. Use `prisma db push` to sync (should detect no changes if names match correctly)

For new projects, use the default `'prisma'` naming unless you need Keystone compatibility.
