---
'@opensaas/stack-auth': patch
---

Fix a better-auth plugin's schema extension of a base model (`user`/`session`/`account`/`verification`) silently dropping the derived Auth list's `db` (`map`/`schema`/`timestamps`) and `access` config.
