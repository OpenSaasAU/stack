---
'@opensaas/stack-core': patch
---

Fix `context.plugins` and the plugin data registry being plain objects keyed by an author-supplied plugin name — a plugin named `__proto__` corrupted the object's prototype, and a name like `constructor` shadowed an inherited member. Registries are now built null-prototype, and a reserved plugin name is now refused at config time with a clear error.
