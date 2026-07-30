---
'@opensaas/stack-ui': minor
---

Add an admin chrome slot for host-supplied navigation (ADR-0021, issue #823).

`AdminUI` now accepts a `navigation` prop that replaces the built-in sidebar wholesale (skipping nav-count resolution), and a `navItems` prop that adds one or more links to the built-in sidebar's new children region:

```tsx
// Add a link to the built-in sidebar
<AdminUI {...props} navItems={[{ label: 'Back to App', href: '/' }]} />

// Or replace the sidebar entirely
<AdminUI {...props} navigation={<MyOwnSidebar />} />
```

`NavLink` is now exported from `@opensaas/stack-ui` (with `active` and `icon` optional) so host-supplied entries render identically to built-in ones, and `deriveCurrentPath` is exported to derive the same `currentPath` `AdminUI` computes internally, for host-owned chrome that needs it.
