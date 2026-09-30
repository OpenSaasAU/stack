---
'@opensaas/stack-core': patch
---

Fix `context.db.<List>.create()` throwing unconditionally for a field carrying both a `defaultValue` and an unconditional field-level `create` deny (`access: { create: () => false }`) — the value `applyCreateDefaults` fills in for an omitted field was being rejected by the deny meant for the caller, not the field's own default. Adds an opt-in `FieldAccess.allowCreateDefault` flag: when set, a field's own declared default is exempted from its `create` deny for a session that omitted the field, while an explicit attempt to write the field is still refused. Off by default, so a session-dependent `create` rule (denies one session, allows another) still blocks the whole create for a denied session exactly as before.
