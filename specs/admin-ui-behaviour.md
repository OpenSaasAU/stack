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

| #    | Expectation                                                                                                                                                                  | Covered by                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 3.1  | `field:value` tokens AND together; a bare word is free text OR-matched across free-text fields.                                                                              | `ListView.test.tsx`, `packages/core/src/filter` tests      |
| 3.2  | Quoted text is one literal value; `\"` and `\\` escape.                                                                                                                      | `FilterBuilder.test.tsx`, `packages/core/src/filter` tests |
| 3.3  | Text "is" means contains, case-insensitive; there is no exact text match.                                                                                                    | `ListView.test.tsx`                                        |
| 3.4  | `-field:value` is "is not" and keeps rows with no value.                                                                                                                     | `packages/core/src/filter` tests                           |
| 3.5  | `field:a,b` is any of.                                                                                                                                                       | `FilterBuilder.test.tsx`, `packages/core/src/filter` tests |
| 3.6  | `field:!` / `-field:!` is empty / not empty, only on fields that can be empty.                                                                                               | `FilterBuilder.test.tsx`, `packages/core/src/filter` tests |
| 3.7  | Numbers, decimals, big integers, timestamps and calendar days take `>` `>=` `<` `<=`.                                                                                        | `packages/core/src/filter` tests                           |
| 3.8  | `a..b` is an inclusive range on fields that take one, literal text elsewhere.                                                                                                | `FilterBuilder.test.tsx`, `packages/core/src/filter` tests |
| 3.9  | `(a OR b)` groups: uppercase `OR`, tight parentheses, no nesting; anything else is plain words.                                                                              | `FilterBuilder.test.tsx`, `packages/core/src/filter` tests |
| 3.10 | `author:pri` matches label text; `author:#id` matches exactly that record; an unreadable record matches nothing.                                                             | `ListView.test.tsx`                                        |
| 3.11 | To-many counts support presence only (`:0`, `:>0`, `:>=1`); other counts become text.                                                                                        | `packages/core/src/filter` tests                           |
| 3.12 | A plain `YYYY-MM-DD` in a URL is the UTC day; the builder writes the local day with its offset. A preset's plain days on timestamp fields are the viewer's local day (4.24). | `packages/core/src/filter` tests                           |
| 3.13 | An empty value filters nothing.                                                                                                                                              | `packages/core/src/filter` tests                           |
| 3.14 | An unknown field or operator degrades to free text, the field name dropped from a positive token.                                                                            | `ListView.test.tsx`                                        |
| 3.15 | A field the session can't read is never filtered on, and negation can't probe it.                                                                                            | `ListView.test.tsx`                                        |
| 3.16 | Every query is ANDed with the access filter.                                                                                                                                 | `ListView.test.tsx`                                        |
| 3.17 | A second "is" typed on a field replaces the first; a pair in the URL shows as two chips and matches nothing.                                                                 | `FilterBuilder.test.tsx`                                   |
| 3.18 | A token naming a field the session doesn't have shows its chip as "Text contains …" with the note "no field called …".                                                       | `FilterBuilderUnknownField.test.tsx`                       |

## Area 4: Filtering, using the Filter builder

Agreed 2026-11-26, reviewed against the live component.

| #    | Expectation                                                                                                                                                                               | Covered by                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 4.1  | Focusing the bar lists every filterable field; typing suggests fields, enumerated values, plain phrases and always a free-text search.                                                    | `FilterBuilder.test.tsx`                                                          |
| 4.2  | Suggestions come only from config and field specs, except access-scoped relationship records.                                                                                             | `FilterBuilder.test.tsx`                                                          |
| 4.3  | Picking a field stages its values with the default condition; the condition switches by click, Tab or Alt+← →.                                                                            | `FilterBuilder.test.tsx`                                                          |
| 4.4  | Conditions offered follow the field: comparisons, is not / does not contain, is any of, is empty / not empty, between.                                                                    | `FilterBuilder.test.tsx`                                                          |
| 4.5  | A value that doesn't fit is explained, not applied.                                                                                                                                       | `FilterBuilder.test.tsx`, `FilterBuilderComparisonWords.test.tsx`                 |
| 4.6  | "Is any of" ticks update one chip and the list at once, the menu staying open.                                                                                                            | `FilterBuilder.test.tsx`                                                          |
| 4.7  | Every committed chip applies at once, in a transition, with no Apply button; text being typed never navigates.                                                                            | `FilterBuilder.test.tsx`, `ListViewClient.test.tsx`                               |
| 4.8  | Any part of a chip edits it in place; × removes it; Clear removes all.                                                                                                                    | `FilterBuilder.test.tsx`                                                          |
| 4.9  | A second "is" or "is any of" replaces the first; "is not" never does; pasted URL syntax becomes chips.                                                                                    | `FilterBuilder.test.tsx`                                                          |
| 4.10 | A value a field can't take, arriving from a URL, shows as text and is written back as read.                                                                                               | `FilterBuilder.test.tsx`                                                          |
| 4.11 | "and" joins chips into an OR group; "or" splits it.                                                                                                                                       | `FilterBuilder.test.tsx`                                                          |
| 4.12 | `or` and a space starts an alternative; Backspace backs out; a phrase starting with "or" is quoted.                                                                                       | `FilterBuilder.test.tsx`                                                          |
| 4.13 | "draft or priya" searches words by default and offers the group next.                                                                                                                     | `FilterBuilder.test.tsx`                                                          |
| 4.14 | An alternative is one filter; a between that can't be one `a..b` token is refused in a group, with a hint.                                                                                | `FilterBuilder.test.tsx`                                                          |
| 4.15 | Between reads `1000-5000`, `1000 to 5000`, `1000..5000`, the phrase form and negative values, and is written as one `a..b`.                                                               | `FilterBuilder.test.tsx`                                                          |
| 4.16 | Date presets write absolute dates on the day they're picked.                                                                                                                              | `FilterBuilder.test.tsx`, `filterBuilderOptions.test.ts`                          |
| 4.17 | Timestamps are written as ISO instants in the browser's offset, covering whole days.                                                                                                      | `filterBuilderOptions.test.ts`                                                    |
| 4.18 | Typed numeric dates follow the locale's day/month order; impossible dates are explained.                                                                                                  | `filterBuilderOptions.test.ts`                                                    |
| 4.19 | Picking a to-one record writes `field:#id` with its label on the chip; typing without picking writes "contains".                                                                          | `FilterBuilder.test.tsx`                                                          |
| 4.20 | Ids in a URL resolve to labels for the viewer; an unreadable record shows its raw id.                                                                                                     | `ListView.test.tsx`                                                               |
| 4.21 | `/` focuses the bar; arrows, Enter, Backspace, ← → and Esc work as documented; counts are announced.                                                                                      | `FilterBuilder.test.tsx`, `KeyboardAccess.test.tsx`                               |
| 4.22 | Header and value funnels stage or add filters; a to-many count links to the other list filtered.                                                                                          | `ListViewFilterFromTable.test.tsx`, `ListViewFilterFromTableServer.test.tsx`      |
| 4.23 | The words a chip shows ("greater than", "at least", "less than", "at most") are read as their symbols when typed.                                                                         | `FilterBuilderComparisonWords.test.tsx`                                           |
| 4.24 | A preset's plain date on a timestamp field resolves to the viewer's local day, from an `opensaas-tz` cookie the admin writes; URL dates stay the UTC day; no cookie means UTC (ADR-0087). | `ListViewPresetTimeZone.test.tsx`, `zonedDays.test.ts`, `ViewerTimeZone.test.tsx` |
