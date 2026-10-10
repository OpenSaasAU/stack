---
'@opensaas/stack-auth': patch
---

Read-deny `Verification.identifier` (it holds the live password-reset token) plus `jwks.privateKey` and `deviceCode.deviceCode`/`userCode`.
