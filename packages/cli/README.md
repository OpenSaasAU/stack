# @opensaas/stack-cli

Command-line tools for OpenSaas Stack - code generation and development utilities.

## Installation

```bash
pnpm add -D @opensaas/stack-cli
```

## Commands

### `opensaas generate`

Generate Prisma schema and TypeScript types from your `opensaas.config.ts`.

```bash
opensaas generate
```

**What it does:**

1. Reads `opensaas.config.ts` from current directory
2. Generates `prisma/schema.prisma` - Prisma schema
3. Generates `.opensaas/types.ts` - TypeScript types
4. Outputs success message with next steps

**Output:**

```
🚀 OpenSaas Generator
- Loading configuration...
✔ Generation complete
✅ Prisma schema generated
✅ TypeScript types generated
✨ Generation complete!

Next steps:
  1. Run: npx prisma generate
  2. Run: npx prisma db push
  3. Start using your generated types!
```

**Example package.json script:**

```json
{
  "scripts": {
    "generate": "opensaas generate"
  }
}
```

### `opensaas dev`

Watch `opensaas.config.ts` and automatically regenerate on changes.

```bash
opensaas dev
```

**What it does:**

1. Runs initial generation
2. Watches `opensaas.config.ts` for changes
3. Automatically regenerates when file changes
4. Runs until you press Ctrl+C

**Output:**

```
🚀 OpenSaas Generator
- Loading configuration...
✔ Generation complete
✅ Prisma schema generated
✅ TypeScript types generated

👀 Watching opensaas.config.ts for changes...
Press Ctrl+C to stop
```

When changes detected:

```
Config changed, regenerating...

🚀 OpenSaas Generator
...
```

**Example package.json script:**

```json
{
  "scripts": {
    "dev": "opensaas dev"
  }
}
```

### `opensaas init` (Coming Soon)

Create a new OpenSaas project with template.

```bash
opensaas init my-project
opensaas init my-project --template blog
```

## Usage in Projects

### Basic Setup

```bash
# Install CLI
pnpm add -D @opensaas/stack-cli

# Add scripts to package.json
{
  "scripts": {
    "generate": "opensaas generate",
    "dev": "opensaas dev"
  }
}

# Generate code
pnpm generate

# Or watch for changes
pnpm dev
```

### Development Workflow

```bash
# Terminal 1: Watch config and regenerate
pnpm dev

# Terminal 2: Run Next.js dev server
pnpm next dev

# Terminal 3: Watch Prisma Studio (optional)
pnpm db:studio
```

### CI/CD Integration

```yaml
# .github/workflows/test.yml
name: Test
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm generate
      - run: npx prisma generate
      - run: pnpm test
```

## Configuration

The CLI reads `opensaas.config.ts` from the current working directory.

**Example config:**

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'

export default config({
  db: {
    provider: 'postgresql',
    url: process.env.DATABASE_URL,
  },
  lists: {
    Post: list({
      fields: {
        title: text(),
      },
    }),
  },
})
```

## Output Files

### Prisma Schema (`prisma/schema.prisma`)

Generated Prisma schema with:

- Database provider configuration
- Models for each list
- Field types and modifiers
- Indexes
- Relationships

**Example output:**

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Post {
  id        String   @id @default(cuid())
  title     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### TypeScript Types (`.opensaas/types.ts`)

Generated TypeScript types for:

- List items
- Create/update input types
- Context types

**Example output:**

```typescript
export type Post = {
  id: string
  title: string
  createdAt: Date
  updatedAt: Date
}

export type PostCreateInput = {
  title: string
}

export type PostUpdateInput = {
  title?: string
}
```

## Troubleshooting

### Config not found

```
Error: Could not find opensaas.config.ts
```

**Solution:** Ensure you're running the command from the directory containing `opensaas.config.ts`.

### TypeScript errors in config

```
Error: Failed to load configuration
```

**Solution:** Check your `opensaas.config.ts` for TypeScript errors. The CLI uses `tsx` to execute the config.

### Permission errors

```
Error: EACCES: permission denied
```

**Solution:** Ensure you have write permissions for `prisma/` and `.opensaas/` directories.

## Examples

### Generate after config changes

```bash
# Edit opensaas.config.ts
vim opensaas.config.ts

# Regenerate
pnpm generate

# Update database
pnpm db:push
```

### Watch mode during development

```bash
# Start watch mode
pnpm dev

# In another terminal, edit config
vim opensaas.config.ts

# Generator automatically reruns!
```

## Integration with Prisma

After running `opensaas generate`:

```bash
# Generate Prisma Client
npx prisma generate

# Push schema to database
npx prisma db push

# Create migration
npx prisma migrate dev --name init

# Open Prisma Studio
npx prisma studio
```

## Learn More

- [Core Package](../core/README.md) - Config and field types
- [OpenSaas Stack](../../README.md) - Stack overview
- [Examples](../../examples) - Working examples

## License

MIT
