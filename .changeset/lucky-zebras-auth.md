---
'create-opensaas-app': patch
---

Fix the with-auth starter template: align all auth URLs to port 3000 (`.env.example` and the `auth-client` default no longer point at 3003), and make the sign-in / sign-up / forgot-password pages legible in light and dark mode by replacing the dark `bg-gray-500/600` card backgrounds with semantic theme tokens (`bg-card`, `text-card-foreground`, `text-muted-foreground`, `text-primary`).
