---
'@opensaas/stack-storage': patch
---

Fix stored XSS where a malformed declared type such as `text/html x` passed the active-content check; one strict parser now serves the check and the stored extension, and a malformed type is stored as `application/octet-stream`.
