---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add customizable join table naming for many-to-many relationships

**New Features:**

1. **Global Keystone Naming:** Set `joinTableNaming: 'keystone'` for automatic KeystoneJS-compatible naming across all M2M relationships
2. **Per-Field Relation Names:** Use `db.relationName` on individual relationship fields for fine-grained control
3. **Hybrid Support:** Combine both options - per-field names override global setting

**Use Cases:**

- **KeystoneJS Migration:** Preserve existing join table names to prevent data loss
- **Custom Naming:** Specify exact relation names for specific relationships
- **Mixed Projects:** Use Keystone naming for migrations while customizing specific tables

**Configuration Options:**

**Option 1: Global Keystone Naming**

```typescript
export default config({
  db: {
    provider: 'postgresql',
    joinTableNaming: 'keystone', // Auto-apply to all M2M relationships
  },
  lists: {
    Lesson: {
      fields: {
        teachers: relationship({ ref: 'Teacher.lessons', many: true }),
        // → Creates implicit join table _Lesson_teachers
      },
    },
  },
})
```

**Option 2: Per-Field Relation Name**

```typescript
lists: {
  Lesson: {
    fields: {
      teachers: relationship({
        ref: 'Teacher.lessons',
        many: true,
        db: { relationName: 'Lesson_teachers' }, // Only set on ONE side
      }),
    },
  },
  Teacher: {
    fields: {
      lessons: relationship({ ref: 'Lesson.teachers', many: true }),
      // Automatically uses same relationName from other side
    },
  },
}
```

**Option 3: Hybrid (per-field overrides global)**

```typescript
export default config({
  db: {
    joinTableNaming: 'keystone', // Default for most relationships
  },
  lists: {
    Lesson: {
      fields: {
        students: relationship({ ref: 'Student.lessons', many: true }),
        // → Uses global Keystone naming: _Lesson_students
        teachers: relationship({
          ref: 'Teacher.lessons',
          many: true,
          db: { relationName: 'CustomTeachers' }, // Override for this one
        }),
        // → Uses custom name: _CustomTeachers
      },
    },
  },
})
```

**How It Works:**

Prisma automatically creates implicit join tables when you use `@relation("name")` on both sides of a many-to-many relationship. The join table is named `_name`. No explicit join table models are generated - Prisma handles this automatically.

**Migration Guide:**

1. Identify all M2M relationships in your Keystone schema
2. Choose strategy:
   - Full migration: Use `joinTableNaming: 'keystone'`
   - Selective: Use per-field `db.relationName`
3. Run `pnpm generate`
4. Verify relation names match (check for `@relation("name")`)
5. Use `prisma db push` to sync

**Validation:**

- Both sides of bidirectional M2M must use matching `relationName` if both specify it
- Only need to set on one side - automatically propagates to other side
- Per-field takes precedence over global setting
