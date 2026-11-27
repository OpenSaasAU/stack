# Admin UI testing plan

Scope: `packages/ui` (AdminUI, fields, cells, standalone components, primitives).

## Where we are (2026-11-25)

- 97 static suites (Vitest + happy-dom + Testing Library), ~1550 tests, plus a browser-mode suite (`tests/browser`, Vitest + Playwright Chromium).
- Line coverage 94%, branch coverage 87% across `src/`.
- High coverage hides two weaknesses:
  1. A few components are only covered incidentally (e.g. `FileField`/`ImageField` only through `KeyboardAccess.test.tsx`).
  2. Coverage measures execution, not assertion strength.

## Layers

| Layer                  | Tool                                       | What belongs there                                                                                     |
| ---------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Static component specs | Vitest + happy-dom                         | Render, props → DOM, callbacks, mode switching, a11y wiring (labels, `aria-*`), server-action payloads |
| Real database specs    | `createTestContext` from core              | Paths where the server action's real behaviour matters (access, constraint errors)                     |
| Browser mode           | `pnpm test:browser`                        | Real focus, pointer/drag, CSS-dependent behaviour, `data-slot` styling                                 |
| End to end             | Playwright against `examples/starter-auth` | Routing, auth, the whole admin round trip                                                              |

## Gaps, by priority

### Tier 1: static specs, done in this change

| Component                    | Before (lines) | Tests to add                                                                                                                      |
| ---------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `fields/ImageField`          | 35%            | non-image rejected, preview via `FileReader`, `showPreview={false}`, remove, drop, read mode with/without image, View/Download    |
| `fields/FileField`           | 53%            | File vs stored metadata display, size formatting, drop (and ignored when disabled), remove, read mode, View/Download              |
| `ItemFormClient`             | 60%            | create/update payloads and navigation, envelope vs legacy results, delete confirm/cancel/failure, `canDelete`, `fieldMode="read"` |
| `primitives/time-picker`     | 29%            | defaults, clamping, keeps the other part of the date                                                                              |
| `primitives/datetime-picker` | 70%            | Confirm, Cancel restores, Clear sends `null`, placeholder                                                                         |

### Tier 2: branch gaps (static)

`AdminUI` (78% branches), `RelationshipTable` (78%), `SingletonView` (78%), `primitives/dropdown-menu` (56%), `TimestampField` (67%). Each needs a targeted look at the uncovered branches before writing tests.

### Tier 3: not static

- Drag-and-drop on file/image fields with real `DataTransfer` (browser mode).
- Popover/calendar keyboard navigation (browser mode).
- Full admin flows: sign in, list, create, edit, delete (e2e).

## Open questions

- Is there value in a coverage floor in CI, or does it encourage low-value tests?
- Mutation testing (e.g. Stryker) on `src/lib` would measure assertion strength directly. Worth a trial on one module?
