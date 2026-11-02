---
'@opensaas/stack-core': patch
---

The Dev database now refuses connections without its per-boot password: PGlite is served on a 0700 unix socket and the TCP port is a cleartext-password front, with the password carried in the state-file URL.
