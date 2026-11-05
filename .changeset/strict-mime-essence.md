---
'@opensaas/stack-storage': patch
---

Fix stored XSS where a malformed declared type such as `text/html x` passed the active-content check; one strict parser now serves the check and the stored extension, and a malformed or browser-sniffed type (`unknown/unknown`, `application/unknown`, `*/*`) is stored as `application/octet-stream`.
`text/xsl` and the remaining WHATWG JavaScript essences are now refused by default, and `isActiveMimeType` returns `true` for a non-empty type that is not a usable essence.
