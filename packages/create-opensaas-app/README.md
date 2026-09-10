# create-opensaas-app

Scaffold a new OpenSaas Stack application with a single command.

## Usage

### Interactive Mode (Recommended)

```bash
npm create opensaas-app@latest
```

You'll be prompted for:

- Project name
- Whether to include authentication (Better-auth)
- Whether to set up AI tooling (the MCP server)

There is no database prompt. `postgresql` is the only provider, and `pnpm dev`
starts a Dev database for you — no connection string to supply before the first
run.

### With Project Name

```bash
npm create opensaas-app@latest my-app
```

### With Flags

```bash
# Basic starter
npm create opensaas-app@latest my-app

# With authentication
npm create opensaas-app@latest my-app --with-auth
```

The scaffolded project runs against the Dev database `pnpm dev` starts. To point
it at your own Postgres instead, set `DATABASE_URL` in `.env` — the generated
`db` block in `opensaas.config.ts` carries no connection of its own.

### Using npx

```bash
npx create-opensaas-app my-app
npx create-opensaas-app my-app --with-auth
```

## Templates

### Basic (`basic`)

A minimal starter with:

- User + Post models
- Admin UI at `/admin`
- Access control examples
- TypeScript + Next.js 16

### With Authentication (`with-auth`)

Includes everything from basic, plus:

- Better-auth integration
- Email/password authentication
- OAuth provider support
- Sign in/sign up pages
- Session management
- Protected routes

## What You Get

A fully configured Next.js application with:

- ✅ **OpenSaas Stack** pre-configured
- ✅ **Admin UI** for managing data
- ✅ **Access control** built-in
- ✅ **TypeScript** with full type safety
- ✅ **Prisma** for database
- ✅ **Next.js 16** with App Router
- ✅ **All dependencies** installed

## After Creating

```bash
cd my-app
pnpm install        # Install dependencies
pnpm dev            # Start the Dev database, generate, reconcile, run the app
```

Visit:

- **Admin UI**: [http://localhost:3000/admin](http://localhost:3000/admin)
- **Home**: [http://localhost:3000](http://localhost:3000)

## Project Structure

```
my-app/
├── app/
│   ├── admin/[[...admin]]/   # Admin UI
│   │   ├── page.tsx
│   │   └── loading.tsx
│   └── layout.tsx
├── opensaas.config.ts        # Schema definition
├── package.json
├── .env                      # Environment variables
└── README.md
```

## Deploy to Production

Once your app is ready, deploy to Vercel + Neon in ~15 minutes:

```bash
# Create Neon database
# Update environment variables
# Deploy to Vercel
```

See the [Deployment Guide](https://stack.opensaas.au/docs/how-to/deploy) for full instructions.

## Learn More

- [Documentation](https://stack.opensaas.au/docs)
- [Quick Start Guide](https://stack.opensaas.au/docs/tutorials/quick-start)
- [Access Control](https://stack.opensaas.au/docs/concepts/access-control)
- [Authentication Guide](https://stack.opensaas.au/docs/how-to/authentication)

## License

MIT
