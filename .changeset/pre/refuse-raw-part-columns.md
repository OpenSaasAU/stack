---
'@opensaas/stack-core': patch
---

Security: a create/update naming a raw part column of a multi-column field (`avatar_url`, `doc_filename`) is refused with a `ValidationError`, sudo included, so the logical field's validation and hooks cannot be bypassed. Write the logical field, or use `context.unsafe`.
