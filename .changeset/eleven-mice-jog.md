---
'@opensaas/stack-auth': minor
---

Bump the `better-auth` dev dependency to `1.7.1` and move the peer range off the stale `^1.3.29` floor to `^1.4.0` (the release line where better-auth's `index: true` flags — the basis for #937's index emission — first shipped; below it the generated schema silently omitted indexes better-auth itself declares).

**New required `account.issuer` column.** better-auth 1.7 adds a required `issuer` column to its `account` model. Because `deriveAuthLists` derives the Auth lists from better-auth's own `getAuthTables()` (#987/#997), this column now appears in the generated schema automatically — no code change was needed, only verification against real generated output. Existing projects upgrading to `better-auth@^1.7` will see a **new NOT NULL column** on their `account` table and need a backfill for existing rows. Following better-auth's own `createLocalAccountIssuer`/`createOAuthAccountIssuer` helpers (`@better-auth/core/db`):

```sql
-- Local (email/password) accounts
UPDATE "Account" SET issuer = 'local:' || "providerId" WHERE issuer IS NULL AND "providerId" = 'credential';

-- OAuth/social accounts without their own OIDC issuer (github, google-without-oidc, etc.)
UPDATE "Account" SET issuer = 'local:oauth:' || "providerId" WHERE issuer IS NULL AND "providerId" != 'credential';
```

URL-encode `providerId` if it can contain characters outside `[A-Za-z0-9_-]`. If you configured a custom OIDC provider with its own issuer URL, use that provider's real issuer instead of the synthetic `local:oauth:` value.

**The new `@@unique([issuer, accountId])` constraint is not yet emitted.** better-auth 1.7 also declares this composite unique index at the table level, but the stack only derives _field_-level `unique`/`index` flags today — table-level index derivation is #985, which hasn't landed. This is deliberately out of scope here (per #986's own triage note: build on #985 once it lands, don't duplicate it). When it does land, make sure your backfilled `issuer` values don't collide on `(issuer, accountId)` for any account, or the constraint will fail to apply.

**Breaking (MCP plugin users only): `@better-auth/mcp` is now a separate package.** better-auth 1.7 split the `mcp` plugin out of `better-auth/plugins` into its own package, rebuilt on the OAuth Provider RFC 8707/9728 resource model. `@opensaas/stack-auth/plugins` now re-exports `mcp` from `@better-auth/mcp` (added as an optional peer — install it if you use MCP). The plugin also now **requires** a `resource` option:

```typescript
import { mcp } from '@opensaas/stack-auth/plugins'
import { jwt } from 'better-auth/plugins'

authPlugin({
  betterAuthPlugins: [
    // The OAuth Provider mcp() is built on issues JWT-based access tokens
    // and requires better-auth's own jwt() plugin registered alongside it —
    // omitting it throws `BetterAuthError: jwt_config` at init.
    jwt(),
    mcp({
      loginPage: '/sign-in',
      // RFC 8707/9728 canonical resource identifier — required as of
      // better-auth 1.7. Must match your `mcp.basePath`. HTTP is only
      // accepted on loopback hosts.
      resource: `${process.env.BETTER_AUTH_URL}/api/mcp`,
    }),
  ],
})
```

better-auth 1.7's MCP plugin also declares a substantially different OAuth table set — the old `oauthApplication`/`oauthAccessToken`/`oauthConsent` three became seven tables (`oauthClient`/`oauthAccessToken`/`oauthConsent`/`oauthRefreshToken`/`oauthResource`/`oauthClientResource`/`oauthClientAssertion`). Since the derivation is schema-driven this needed no code changes, but if you have the MCP plugin enabled, running `pnpm generate` will produce a significantly different Prisma schema for these tables (new/renamed models, and `Session` gains reverse relations to the two token tables that now reference it). Review the diff and migrate your database accordingly.

Also fixes two `deriveAuthLists` gaps surfaced by the MCP plugin's expanded schema:

- the scalar-field builder now threads a static `defaultValue` through for `number`-typed fields (`integer()`/`bigInt()`), matching the existing `string`/`boolean` behavior (e.g. `oauthResource.policyVersion`, which defaults to `1`)
- a plugin table that declares only one of `createdAt`/`updatedAt` upstream (several of the new OAuth tables declare `createdAt` alone) is no longer silently dropped — it derives as an ordinary required column instead. Previously any model with an asymmetric timestamp pair had the field skipped entirely with no replacement, which crashed the first real write that supplied it (better-auth's own OAuth Provider does this at `betterAuth()` init time, seeding an `oauthResource` row)
