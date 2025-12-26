---
'@opensaas/stack-core': minor
---

Add inputData parameter to field-level access control functions

Field-level access control functions now receive an `inputData` parameter for create and update operations, allowing you to validate incoming data before it's written to the database.

This is particularly useful for validating relationship connections:

```typescript
lists: {
  Student: list({
    fields: {
      account: relationship({
        ref: 'Account.students',
        access: {
          create: ({ inputData, session }) => {
            // Ensure students can only connect to their own account
            if (session?.data?.role !== 'ADMIN') {
              return inputData?.account?.connect?.id === session?.data?.accountId
            }
            return true
          },
        },
      }),
    },
  }),
}
```

The `inputData` parameter contains the original input data passed to create/update operations:

- For **create** operations: contains all input data including relationship connection syntax
- For **update** operations: contains only the fields being updated
- For **read** operations: `inputData` is undefined

Existing field access control functions continue to work without modification since `inputData` is optional.
