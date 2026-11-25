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

## Area 2: List view (columns, sorting, paging, presets)

Agreed 2026-11-25. Filtering has its own area.

### Columns

| #   | Expectation                                                                                                                                                                           | Covered by                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 2.1 | With no `?columns=`, the list shows `ui.listView.initialColumns`, else the default set.                                                                                               | `AdminUIListView.test.tsx`, `ListView.test.tsx`                              |
| 2.2 | The Columns menu writes `?columns=` (visible columns and order); Reset columns drops it, and so does a pick equal to the default set.                                                 | `ListViewTableControls.test.tsx`                                             |
| 2.3 | Column names the list doesn't display are ignored; with none left it falls back to the default set.                                                                                   | `ListView.test.tsx`                                                          |
| 2.4 | A field the applied filter uses is always shown, appended, ticked and locked, and never written to `?columns=`.                                                                       | `ListViewFilterFromTable.test.tsx`, `ListViewFilterFromTableServer.test.tsx` |
| 2.5 | A field the session can never read is not offered as a column and a `?columns=` naming it is ignored; a row-dependent read rule shows the column with no value on the rows it denies. | `ListView.test.tsx`                                                          |

### Sorting

| #   | Expectation                                                                                                     | Covered by                                               |
| --- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 2.6 | One sort at a time, from a header or the toolbar's Sort menu.                                                   | `ListViewTableControls.test.tsx`                         |
| 2.7 | Only columns the session's read can order by offer a sort, never a relationship; any other `?sort=` is ignored. | `ListView.test.tsx`, `ListViewTableControls.test.tsx`    |
| 2.8 | `?sort=` wins over `initialSort`; rows tie-break by id.                                                         | `ListView.test.tsx`, `ListViewPresetResolution.test.tsx` |

### Paging and size

| #    | Expectation                                                                                                                                                  | Covered by                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 2.9  | 50 rows by default; a 25/50/100 control past 25 rows; `?pageSize=` up to 200, anything invalid falls back.                                                   | `ListViewTableControls.test.tsx`                  |
| 2.10 | "Showing x to y of z" and Previous/Next appear only with more than one page. The total is the access-scoped count of the filtered set.                       | `ListView.test.tsx`, `ListViewPageRange.test.tsx` |
| 2.11 | A page past the end goes to the last page (page 1 when empty), keeping the rest of the query, and never shows "No items yet" or a nonsense range on the way. | `ListViewPageRange.test.tsx`                      |
| 2.12 | Density is remembered per browser; the server renders comfortable.                                                                                           | `ListViewTableControls.test.tsx`                  |
| 2.13 | Below the tablet breakpoint each row is a labelled card with the row menu in its corner.                                                                     | `ListViewClient.test.tsx`                         |

### Rows and empty states

| #    | Expectation                                                                                                                                                 | Covered by                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 2.14 | The title column links to the item; it is the label field, else the first non-relationship column; a cell with its own links gets an "Open" link beside it. | `ListViewClient.test.tsx`, `ListViewFilterFromTable.test.tsx`                |
| 2.15 | An empty list says "No items yet", offering Create only when the session may create.                                                                        | `ListView.test.tsx`, `ListUiOptions.test.tsx`                                |
| 2.16 | No matches offers removing the single filter that returns the most rows, and Clear filters.                                                                 | `ListViewFilterFromTable.test.tsx`, `ListViewFilterFromTableServer.test.tsx` |
| 2.17 | A failed read shows "This list could not be loaded" with Reload; the error is logged, never shown.                                                          | `ListView.test.tsx`                                                          |

### Preset views

| #    | Expectation                                                                                                    | Covered by                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 2.18 | Presets show as tabs after All, without counts; `hasAccess` hides a tab.                                       | `ListViewPresets.test.tsx`, `ListViewPresetResolution.test.tsx` |
| 2.19 | `?preset=` resolves the preset's search for whoever opens the link.                                            | `ListViewPresetResolution.test.tsx`                             |
| 2.20 | The first edit turns the preset into a plain `?search=` and drops `?preset=`, with nothing on screen changing. | `ListViewPresets.test.tsx`                                      |
| 2.21 | An unknown, denied or throwing preset opens the plain list; while one is open, `?search=` is ignored.          | `ListViewPresetResolution.test.tsx`                             |

## Area 3: Filtering, what a query means

Agreed 2026-11-25. The grammar is documented in full under "Filtering and sorting" in `docs/content/reference/ui.md`; these are the behaviours agreed against it.

| #    | Expectation                                                                                                                                                                                         | Covered by                                                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 3.1  | `field:value` tokens AND together; a bare word is free text OR-matched across free-text fields.                                                                                                     | `ListView.test.tsx`, `packages/core/src/filter` tests      |
| 3.2  | Quoted text is one literal value; `\"` and `\\` escape.                                                                                                                                             | `FilterBuilder.test.tsx`, `packages/core/src/filter` tests |
| 3.3  | Text "is" means contains, case-insensitive; there is no exact text match.                                                                                                                           | `ListView.test.tsx`                                        |
| 3.4  | `-field:value` is "is not" and keeps rows with no value.                                                                                                                                            | `packages/core/src/filter` tests                           |
| 3.5  | `field:a,b` is any of.                                                                                                                                                                              | `FilterBuilder.test.tsx`, `packages/core/src/filter` tests |
| 3.6  | `field:!` / `-field:!` is empty / not empty, only on fields that can be empty.                                                                                                                      | `FilterBuilder.test.tsx`, `packages/core/src/filter` tests |
| 3.7  | Numbers, decimals, big integers, timestamps and calendar days take `>` `>=` `<` `<=`.                                                                                                               | `packages/core/src/filter` tests                           |
| 3.8  | `a..b` is an inclusive range on fields that take one, literal text elsewhere.                                                                                                                       | `FilterBuilder.test.tsx`, `packages/core/src/filter` tests |
| 3.9  | `(a OR b)` groups: uppercase `OR`, tight parentheses, no nesting; anything else is plain words.                                                                                                     | `FilterBuilder.test.tsx`, `packages/core/src/filter` tests |
| 3.10 | `author:pri` matches label text; `author:#id` matches exactly that record; an unreadable record matches nothing.                                                                                    | `ListView.test.tsx`                                        |
| 3.11 | To-many counts support presence only (`:0`, `:>0`, `:>=1`); other counts become text.                                                                                                               | `packages/core/src/filter` tests                           |
| 3.12 | A plain `YYYY-MM-DD` in a URL or preset is the UTC day; the builder writes the local day with its offset. Open: you chose viewer-local days for presets on timestamp fields; the design is pending. | `packages/core/src/filter` tests                           |
| 3.13 | An empty value filters nothing.                                                                                                                                                                     | `packages/core/src/filter` tests                           |
| 3.14 | An unknown field or operator degrades to free text, the field name dropped from a positive token.                                                                                                   | `ListView.test.tsx`                                        |
| 3.15 | A field the session can't read is never filtered on, and negation can't probe it.                                                                                                                   | `ListView.test.tsx`                                        |
| 3.16 | Every query is ANDed with the access filter.                                                                                                                                                        | `ListView.test.tsx`                                        |
| 3.17 | A second "is" typed on a field replaces the first; a pair in the URL shows as two chips and matches nothing.                                                                                        | `FilterBuilder.test.tsx`                                   |
| 3.18 | A token naming a field the session doesn't have shows its chip as "Text contains …" with the note "no field called …".                                                                              | `FilterBuilderUnknownField.test.tsx`                       |
