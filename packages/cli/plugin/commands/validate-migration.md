---
description: Validate the generated opensaas.config.ts file
---

Validate the generated opensaas.config.ts file.

## Instructions

1. Check if opensaas.config.ts exists in the project root

2. If it exists, verify:
   - Syntax is valid TypeScript
   - All imports are correct
   - Database config is complete
   - Lists match original schema

3. Try running:
   ```bash
   npx @opensaas/stack-cli generate
   ```

4. Report any errors and suggest fixes

5. If validation passes, confirm next steps:
   - `npx prisma generate`
   - `npx prisma db push`
   - `pnpm dev`

## Common Issues

- Missing dependencies → suggest `pnpm add ...`
- Database URL not set → remind about .env file
- Type errors → suggest specific fixes
