---
'@opensaas/stack-cli': minor
---

Surface the canonical Keystone migration guide and the `opensaas-migration` plugin install steps from `opensaas migrate`

`opensaas migrate` now prints the published Keystone → stack guide URL and how to install the `opensaas-migration` Claude Code plugin (its skills and commands). The same pointers are available via `opensaas migrate --help` without running a migration. The CLI links to the canonical guide rather than embedding its text.

```bash
# Both surface the guide URL + plugin install steps
opensaas migrate
opensaas migrate --help
```

Output points at:

- Guide: https://stack.opensaas.au/docs/guides/migrating-from-keystone
- Plugin (automatic): `npx @opensaas/stack-cli migrate --with-ai`
- Plugin (manual, inside Claude Code):
  - `/plugin marketplace add OpenSaasAU/stack`
  - `/plugin install opensaas-migration@opensaas-stack-marketplace`
