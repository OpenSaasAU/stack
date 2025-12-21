---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add `extendPrismaSchema` function to database configuration

You can now modify the generated Prisma schema before it's written to disk using the `extendPrismaSchema` function in your database config. This is useful for advanced Prisma features not directly supported by the config API.

Example usage - Add multi-schema support for PostgreSQL:

```typescript
export default config({
  db: {
    provider: 'postgresql',
    prismaClientConstructor: (PrismaClient) => {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
      const adapter = new PrismaPg(pool)
      return new PrismaClient({ adapter })
    },
    extendPrismaSchema: (schema) => {
      let modifiedSchema = schema

      // Add schemas array to datasource
      modifiedSchema = modifiedSchema.replace(
        /(datasource db \{[^}]+provider\s*=\s*"postgresql")/,
        '$1\n  schemas = ["public", "auth"]',
      )

      // Add @@schema("public") to all models
      modifiedSchema = modifiedSchema.replace(
        /^(model \w+\s*\{[\s\S]*?)(^}$)/gm,
        (match, modelContent) => {
          if (!modelContent.includes('@@schema')) {
            return `${modelContent}\n  @@schema("public")\n}`
          }
          return match
        },
      )

      return modifiedSchema
    },
  },
  // ... rest of config
})
```

Common use cases:

- Multi-schema support for PostgreSQL
- Custom model or field attributes
- Prisma preview features
- Output path modifications
