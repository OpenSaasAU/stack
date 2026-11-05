---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add list-level `db.foreignKeys` for composite (multi-column) foreign key constraints that reference a composite unique on the target. Constraint-only: no relationship or include semantics.

```ts
db: {
  foreignKeys: [
    {
      fields: ['enrolment', 'student', 'lessonTerm'],
      references: { list: 'Enrolment', fields: ['id', 'student', 'lessonTerm'] },
      onDelete: 'restrict',
    },
  ],
}
```

`db.indexes` also accepts `'id'` so a composite unique can include the primary key.
