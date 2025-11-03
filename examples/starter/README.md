# OpenSaas Stack Starter

A minimal starter template for building applications with OpenSaas Stack.

## What's Included

- **Admin UI** at `/admin` for managing your data
- **User & Post models** with relationships
- **Access control** examples
- **SQLite database** (easy to switch to PostgreSQL)
- **TypeScript** with full type safety
- **Next.js 16** with App Router

## Getting Started

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Generate Prisma Schema

```bash
pnpm generate
```

This creates:

- `prisma/schema.prisma` - Database schema
- `.opensaas/types.ts` - TypeScript types
- `.opensaas/context.ts` - Context factory

### 3. Set Up Database

```bash
pnpm db:push
```

This creates your SQLite database file.

### 4. Start Development Server

```bash
pnpm dev
```

Visit:

- **Admin UI**: [http://localhost:3000/admin](http://localhost:3000/admin)
- **Home**: [http://localhost:3000](http://localhost:3000)

## Project Structure

```
├── app/
│   ├── admin/[[...admin]]/  # Admin UI (auto-generated CRUD)
│   │   ├── page.tsx
│   │   └── loading.tsx
│   └── layout.tsx           # Root layout with UI styles
├── opensaas.config.ts       # Schema definition
├── .env                     # Database connection
└── package.json
```

## Customize Your Schema

Edit `opensaas.config.ts` to add your own models:

```typescript
export default config({
  db: {
    provider: 'sqlite',
    url: 'file:./dev.db',
  },
  lists: {
    // Add your models here
    Product: list({
      fields: {
        name: text({ validation: { isRequired: true } }),
        price: integer(),
        // ... more fields
      },
    }),
  },
})
```

Then regenerate:

```bash
pnpm generate
pnpm db:push
```

## Available Scripts

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm generate` - Generate Prisma schema and types
- `pnpm db:push` - Push schema to database
- `pnpm db:studio` - Open Prisma Studio
- `pnpm clean` - Remove build artifacts

## Switching to PostgreSQL

1. Update `.env`:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/mydb?schema=public"
```

2. Update `opensaas.config.ts`:

```typescript
db: {
  provider: 'postgresql',
  url: process.env.DATABASE_URL!,
}
```

3. Regenerate and push:

```bash
pnpm generate
pnpm db:push
```

## Deploy to Production

Ready to deploy? Check out the [Deployment Guide](https://stack.opensaas.au/docs/guides/deployment) for step-by-step instructions on deploying to Vercel + Neon.

## Learn More

- [Documentation](https://stack.opensaas.au/docs)
- [Access Control](https://stack.opensaas.au/docs/core-concepts/access-control)
- [Field Types](https://stack.opensaas.au/docs/core-concepts/field-types)
- [Hooks](https://stack.opensaas.au/docs/core-concepts/hooks)

## Need Help?

- [GitHub Issues](https://github.com/OpenSaasAU/stack/issues)
- [Documentation](https://stack.opensaas.au/docs)
