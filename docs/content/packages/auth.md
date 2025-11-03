# Auth Package

Authentication integration with Better-auth.

## Installation

```bash
pnpm add @opensaas/stack-auth
```

## Features

- Better-auth integration
- Auto-generated auth lists (User, Session, Account, Verification)
- OAuth support
- Session management

## Usage

```typescript
import { withAuth, authConfig } from '@opensaas/stack-auth/config'

export default withAuth(
  config({
    db: { provider: 'sqlite', url: 'file:./dev.db' },
    lists: { /* your lists */ },
  }),
  authConfig({
    sessionFields: ['userId', 'email', 'name', 'role'],
  })
)
```

See [Authentication Guide](/docs/guides/authentication) for more details.
