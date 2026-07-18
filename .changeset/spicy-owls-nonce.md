---
'@opensaas/stack-ui': minor
---

Add optional `nonce` prop to `ThemeScript` for strict-CSP compatibility

`ThemeScript` renders the flash-prevention code as an inline `<script>`, which a
strict nonce-based `script-src` Content-Security-Policy blocks unless the tag
carries a matching `nonce`. You can now forward the per-request nonce:

```tsx
import { headers } from 'next/headers'
import { ThemeScript } from '@opensaas/stack-ui'

export default async function RootLayout({ children }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript nonce={nonce} />
      </head>
      <body>{children}</body>
    </html>
  )
}
```

The prop is optional — omitting it is byte-identical to before (no `nonce`
attribute emitted). When provided, the value is forwarded only to the
`<script>`'s `nonce` attribute; it is never interpolated into the script body.
