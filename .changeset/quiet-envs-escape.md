---
'@opensaas/stack-cli': patch
---

`opensaas dev` and `generate` now load `.env.development.local`, `.env.local`, `.env.development` and `.env` in Next's precedence, so a `DATABASE_URL` in `.env.local` takes the Database escape (no Dev database) with a warning naming the file, instead of the app silently diverging from the reconciled database.
