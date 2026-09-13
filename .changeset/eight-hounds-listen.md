---
'@opensaas/stack-core': minor
'@opensaas/stack-auth': patch
---

Add `getPluginData<T>(config, pluginName)`, a typed reader paired with `setPluginData<T>`, so a consumer reading a plugin's stored data no longer casts `config._pluginData` itself:

```typescript
import { getPluginData } from '@opensaas/stack-core'
import type { NormalizedAuthConfig } from '@opensaas/stack-auth'

const resolvedConfig = await config
const authConfig = getPluginData<NormalizedAuthConfig>(resolvedConfig, 'auth')
```

`@opensaas/stack-auth`'s `buildBetterAuthOptions` and the core MCP handler's plugin-tool lookup both adopt it in place of their own casts.
