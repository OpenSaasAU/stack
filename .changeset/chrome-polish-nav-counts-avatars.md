---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Admin chrome polish: opt-in nav counts and avatar label cells (#735)

Two per-list opt-ins for the admin UI, both off by default.

**Nav counts** — set `ui.navCount: true` on a list to show an access-scoped
record count next to its nav item. The count is fetched through the secured
context, so it only ever reflects what the current session may see; no count
query runs for lists that don't opt in, and a list whose query access is
statically denied renders no count rather than a misleading zero.

```typescript
lists: {
  Post: list({
    fields: {
      /* ... */
    },
    ui: { navCount: true },
  }),
}
```

**Avatar label cells** — set `ui.avatar: true` to render a list's label column
with a deterministic initials bubble ahead of the emphasized Item label. The
initials and colour derive from the row; the palette is Theme-token-derived (no
raw hex). A per-field cell override (`ui.cell`) on the label field still wins.

```typescript
lists: {
  User: list({
    fields: {
      /* ... */
    },
    ui: { avatar: true },
  }),
}
```

New exports:

- `@opensaas/stack-core`: `resolveNavCounts`, `isListQueryStaticallyDenied`
- `@opensaas/stack-ui`: `Avatar` primitive, `AvatarLabelCell`, and the
  `getInitials`, `getAvatarTone`, `AVATAR_TONES` helpers. New Slots:
  `avatar`, `cell-avatar-label`, `nav-count`.
