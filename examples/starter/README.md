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

### 3. Start Development Server

```bash
pnpm dev
```

`opensaas dev` starts the Dev database for this project, generates, reconciles
the database with what it emits, and then runs `next dev`. Step 2 is what it
does for you on every start and on every edit to `opensaas.config.ts`.

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

`pnpm dev` picks the edit up: it regenerates and reconciles the database
before the app reloads. A change that would destroy data is not applied — the
plan is printed and the app keeps serving until you run `pnpm db:update`.

## Available Scripts

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm generate` - Generate Prisma schema and types
- `pnpm db:update` - Apply a staged schema change through the running dev loop
- `pnpm db:studio` - Open Prisma Studio
- `pnpm clean` - Remove build artifacts

## Using Your Own Postgres

`DATABASE_URL` set means no Dev database starts and everything — the app, the
generator and `db update` — talks to the server you point it at:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/mydb"
```

Unset it again and `pnpm dev` goes back to running the Dev database.

## Deploy to Production

Ready to deploy? Check out the [Deployment Guide](https://stack.opensaas.au/docs/how-to/deploy) for step-by-step instructions on deploying to Vercel + Neon.

## Learn More

- [Documentation](https://stack.opensaas.au/docs)
- [Access Control](https://stack.opensaas.au/docs/concepts/access-control)
- [Field Types](https://stack.opensaas.au/docs/concepts/field-types)
- [Hooks](https://stack.opensaas.au/docs/concepts/hooks)

## Need Help?

- [GitHub Issues](https://github.com/OpenSaasAU/stack/issues)
- [Documentation](https://stack.opensaas.au/docs)
