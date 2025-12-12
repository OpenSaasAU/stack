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

### `opensaas init`

Create a new OpenSaas Stack project.

**Note:** This command delegates to `create-opensaas-app` for scaffolding. It's kept for backwards compatibility.

```bash
npx @opensaas/stack-cli init my-project
```

**Recommended:** Use `npm create opensaas-app` instead:

```bash
npm create opensaas-app@latest my-project
```

**Options:**

- `project-name` - Name of your project (lowercase, numbers, hyphens only)
- `--with-auth` - Include Better-auth integration

**Examples:**

```bash
# Basic project
npx @opensaas/stack-cli init my-app

# With authentication
npx @opensaas/stack-cli init my-app --with-auth
```

**What happens:**

This command runs `npx create-opensaas-app@latest` with the provided arguments. See the [create-opensaas-app package](../create-opensaas-app) for full details.

**After init:**

```bash
cd my-project
pnpm install
pnpm generate    # Generate Prisma schema and types
pnpm db:push     # Create database
pnpm dev         # Start dev server
```

### `opensaas migrate`

Migrate an existing Prisma, KeystoneJS, or Next.js project to OpenSaas Stack.

```bash
opensaas migrate [options]
```

**Options:**

- `--with-ai` - Enable AI-guided migration with Claude Code
- `--type <type>` - Force project type detection (prisma, nextjs, keystone)

**What it does:**

1. Detects project type (Prisma, KeystoneJS, Next.js)
2. Analyzes schema and counts models
3. With `--with-ai`: Sets up Claude Code integration
4. Provides next steps for migration

**Examples:**

```bash
# Basic migration analysis
opensaas migrate

# AI-guided migration (recommended)
opensaas migrate --with-ai

# Force project type
opensaas migrate --type prisma --with-ai
```

**AI-Assisted Migration (with --with-ai):**

```
🚀 OpenSaas Stack Migration

✔ Detected: prisma, nextjs
✔ Found 8 models
   ├─ User (6 fields)
   ├─ Post (10 fields)
   ├─ Comment (5 fields)
   └─ ...
✔ Claude Code ready
   ├─ Created .claude directory
   ├─ Generated migration assistant
   └─ Registered MCP server

✅ Analysis complete!

🤖 Next Steps:

   1. Open this project in Claude Code
   2. Ask: "Help me migrate to OpenSaas Stack"
   3. Follow the interactive wizard
```

**After running:**

1. Open project in Claude Code
2. Ask: "Help me migrate to OpenSaas Stack"
3. Answer wizard questions about:
   - Database configuration
   - Authentication needs
   - Access control patterns
   - Admin UI preferences
4. Claude generates `opensaas.config.ts`
5. Install dependencies and run `opensaas generate`

**Manual Migration:**

Without `--with-ai`, the command provides project analysis and you create the config manually.

**See also:** [Migration Guide](https://stack.opensaas.au/docs/guides/migration)

## Usage in Projects

### Quick Start (New Projects)

**Recommended:** Use `create-opensaas-app`:

```bash
npm create opensaas-app@latest my-project
cd my-project
pnpm install
pnpm generate
pnpm db:push
pnpm dev
```

**Alternative:** Via CLI package:

```bash
npx @opensaas/stack-cli init my-project
cd my-project
pnpm install
pnpm generate
pnpm db:push
pnpm dev
```

### Manual Setup (Existing Projects)

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
