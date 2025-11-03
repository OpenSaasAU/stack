# OpenSaas Stack Starter (with Better-auth)

A starter template with authentication built in using Better-auth.

## What's Included

- **Better-auth integration** with email/password and OAuth
- **Sign in/Sign up UI** pre-built
- **Session management** automatic
- **Admin UI** at `/admin` for managing data
- **Protected routes** with session-based access control
- **SQLite database** (easy to switch to PostgreSQL)
- **TypeScript** with full type safety
- **Next.js 16** with App Router

## Getting Started

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Set Up Environment Variables

Copy the example env file:

```bash
cp .env.example .env
```

Generate a random secret for Better-auth:

```bash
openssl rand -base64 32
```

Update `.env`:

```env
DATABASE_URL="file:./dev.db"
BETTER_AUTH_SECRET="your-generated-secret-here"
BETTER_AUTH_URL="http://localhost:3000"
```

### 3. Generate Schema and Database

```bash
pnpm generate
pnpm db:push
```

### 4. Start Development Server

```bash
pnpm dev
```

Visit:

- **Home**: [http://localhost:3000](http://localhost:3000)
- **Sign In**: [http://localhost:3000/sign-in](http://localhost:3000/sign-in)
- **Sign Up**: [http://localhost:3000/sign-up](http://localhost:3000/sign-up)
- **Admin UI**: [http://localhost:3000/admin](http://localhost:3000/admin)

## Learn More

- [Documentation](https://stack.opensaas.au/docs)
- [Better-auth Integration](https://stack.opensaas.au/docs/guides/authentication)
- [Access Control](https://stack.opensaas.au/docs/core-concepts/access-control)

## Need Help?

- [GitHub Issues](https://github.com/OpenSaasAU/stack/issues)
- [Documentation](https://stack.opensaas.au/docs)
