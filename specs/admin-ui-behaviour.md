# Admin UI expected behaviour

What the admin UI should do, agreed area by area. Each line is an expectation: a test that disagrees with one is a bug, not a test to update. Changing an expectation means changing this file first.

The review sheet used to agree these is the "Admin UI Expectations" artifact.

## Area 1: Routing, navigation and dashboard

Agreed 2026-11-25.

### Routing

| #   | Expectation                                                                             | Covered by                                                                                            |
| --- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1.1 | `/admin` shows the Dashboard.                                                           | `AdminUIListRouting.test.tsx`                                                                         |
| 1.2 | `/admin/blog-post` shows the BlogPost list; list keys are kebab-cased in the URL.       | `AdminUIListRouting.test.tsx`                                                                         |
| 1.3 | `/admin/<list>/create` shows the create form; `/admin/<list>/<id>` shows the edit form. | `AdminUIIdCoercion.test.tsx`, `AdminUIRouteExpectations.test.tsx`                                     |
| 1.4 | A singleton's URL opens its editor directly; any extra segment redirects back to it.    | `AdminUISingleton.test.tsx`, `AdminUISingletonSuppress.test.tsx`, `AdminUIRouteExpectations.test.tsx` |
| 1.5 | An id that doesn't match the list's id type is a 404.                                   | `AdminUIIdCoercion.test.tsx`                                                                          |
| 1.6 | A URL naming no list is a 404, on its list, create and item routes.                     | `AdminUIRouteExpectations.test.tsx`, `AdminUIListRouting.test.tsx`                                    |
| 1.7 | Segments after an item id or after `create` are a 404.                                  | `AdminUIRouteExpectations.test.tsx`                                                                   |

### Access

| #    | Expectation                                                                                                | Covered by                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1.8  | Lists the session can't query are left out of the sidebar and the Dashboard.                               | `AdminUIAccessExpectations.test.tsx`                           |
| 1.9  | Opening such a list by URL shows "can't be shown here", still offering Create when the session may create. | `ListView.test.tsx`                                            |
| 1.10 | "Item not found" is the same whether the item doesn't exist or the session can't see it.                   | `AdminUIAccessExpectations.test.tsx`                           |
| 1.11 | `/create` without create access shows "can't be created here"; with `ui.hideCreate` it is a 404.           | `AdminUIAccessExpectations.test.tsx`, `ListUiOptions.test.tsx` |

### Dashboard

| #    | Expectation                                                                                                | Covered by                                                                |
| ---- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1.12 | Each visible list has a card with its access-scoped count ("3 items" / "1 item").                          | `SingletonNavDashboard.test.tsx`, `AdminUIAccessExpectations.test.tsx`    |
| 1.13 | A list whose count fails shows "Count unavailable", never a number.                                        | `AdminUIRouteExpectations.test.tsx`                                       |
| 1.14 | Singletons sit in a separate Settings section, with no count.                                              | `SingletonNavDashboard.test.tsx`                                          |
| 1.15 | Quick Actions lists "Create X" for each list the session can create in, and is hidden when there are none. | `AdminUIAccessExpectations.test.tsx`, `AdminUISingletonSuppress.test.tsx` |

### Navigation

| #    | Expectation                                                                                                                                                           | Covered by                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1.16 | `navItems` adds links after the built-in groups; `navigation` replaces the sidebar and wins over `navItems` with a dev-only warning; `navigation={false}` removes it. | `AdminUINavigationSlot.test.tsx` |
| 1.17 | Sign Out appears only when `onSignOut` is passed.                                                                                                                     | `UserMenu.test.tsx`              |
