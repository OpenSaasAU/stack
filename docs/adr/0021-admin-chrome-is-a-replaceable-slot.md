# Admin chrome is a replaceable slot; nav entries live at the mount site

`AdminUI` rendered its sidebar unconditionally, so an app mounting the admin at a sub-path beside its own bespoke admin had no way to link back out — and no way to supply chrome of its own short of reimplementing `AdminUI`'s routing (URL-segment parsing, the singleton redirect, per-route Suspense skeletons, theme compilation, nav-count resolution). We decided the Admin chrome is a **replaceable slot**: `AdminUI` accepts a `navigation` node that replaces the built-in sidebar wholesale while `AdminUI` keeps routing and the shell, `Navigation` accepts `children` in a dedicated region below its list and singleton groups, and `NavLink` becomes public so host entries carry the same active state, icon slot, count badge, and `data-slot` contract as built-in ones. A `navItems` array on `AdminUI` is sugar over that same children region for the common "add one link" case. Nav entries are supplied at the **mount site**, never through `UIConfig`.

## Considered Options

- **A narrow `navItems`-only extension point**: smallest surface and covers the filed request, but leaves ADR-0016's "compose your own pages" rung unreachable for chrome — the ladder's top rung assumes composition is available, and for the sidebar it wasn't.
- **A content-only `chrome={false}` mode**: maximum freedom, but a blunt boolean that can't express "my sidebar, your layout", and it pushes the shell and scroll container onto every host.
- **Splitting into `AdminChrome` + `AdminContent`**: architecturally cleanest, but a second public component whose props contract every future routing change must stay compatible with.
- **A render-prop or component-type `navigation`** that receives `AdminUI`'s already-resolved `currentPath`/`navCounts`: avoids the host re-resolving them, at the cost of a function or component prop crossing a server-component boundary and a wider contract to keep stable. Rejected in favour of a plain node plus public helpers (`resolveNavCounts`, and an exported derivation of `currentPath` from route params so that rule keeps one owner).
- **Config-level nav entries under `UIConfig`**: rejected. `UIConfig` lives in `@opensaas/stack-core`, which must not import React, so config-borne icons could only ever be name strings resolved through a second registry. Host links are also routing owned by the host application, not schema that belongs in shared config.

## Consequences

- This does **not** reopen ADR-0016. The line is: chrome may be replaced wholesale at the mount site; components _inside_ the built-in chrome still may not be swapped. "Can I swap the Button inside `AdminUI`?" remains no.
- `NavLink` joins the public API, so its props and its `data-slot="nav-link"` handle become a compatibility promise. `active` and `icon` are optional (`active` defaults to `false`, correct for links leaving the mount; an icon-less entry still reserves the icon box so labels align).
- `navigation` and `navItems` cannot merge — the slot is a prebuilt node — so the slot wins and `navItems` is ignored with a development-only warning. Both props absent reproduces today's rendering exactly.
- Host-owned chrome resolves its own access-scoped counts; `AdminUI` skips `resolveNavCounts` when the slot is supplied, so the queries aren't paid twice.
- The `navCount` precedent (per-list opt-in in list config) still stands for the admin's _own_ lists. That is list configuration; host links are not.
