---
'@opensaas/stack-core': patch
---

Make non-sudo writes fail loud in `filterWritableFields` (Keystone parity).

Undeclared `data` keys on create/update now throw instead of passing through unchecked (#564), and fields denied by field-level access now throw instead of being silently stripped (#568). `sudo` remains the single trusted bypass; system fields and relationship foreign keys still pass through. Raw multi-column split columns (e.g. `media_url`/`media_size` from an `image()`/`file()` field) are now gated by their owning field's write access — supplying them directly under non-sudo when that field denies the write throws, instead of bypassing the field's `access.create`/`access.update`.

Behavioural narrowing: a list-level `resolveInput` hook that adds keys to `resolvedData` which are not declared fields will now be rejected by the undeclared-key throw. No production hook does this today.
