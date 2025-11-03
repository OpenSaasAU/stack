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
- SQLite database
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
pnpm generate       # Generate Prisma schema and types
pnpm db:push        # Create database
pnpm dev            # Start development server
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

See the [Deployment Guide](https://stack.opensaas.au/docs/guides/deployment) for full instructions.

## Learn More

- [Documentation](https://stack.opensaas.au/docs)
- [Quick Start Guide](https://stack.opensaas.au/docs/quick-start)
- [Access Control](https://stack.opensaas.au/docs/core-concepts/access-control)
- [Authentication Guide](https://stack.opensaas.au/docs/guides/authentication)

## License

MIT
