---
'@opensaas/stack-ui': minor
---

Refresh the admin list table: a column picker, density, page sizes, a toolbar sort control and cards on phones

- `?columns=title,status,views` sets the visible columns, in order. The toolbar's Columns menu writes it. `ListView` resolves it on the server (new `visibleColumns` prop, which `AdminUI` fills from the URL), so a to-many count in an added column is read and correct. Unknown names are ignored, and Field Visibility still applies.
- Density is comfortable or compact, remembered in this browser under `opensaas-list-density` (`DENSITY_STORAGE_KEY`) like the theme choice, and rendered comfortable on the server.
- Rows per page offers 25, 50 and 100. The default stays 50 and the `?pageSize=` cap stays 200.
- A toolbar Sort menu sits beside header sorting. Sort stays single-column; relationship columns stay unsortable.
- Below `md`, rows render as labelled cards with no sideways scrolling. This replaces the sticky Actions column in the list view.
- New `DropdownMenu` primitive on `@radix-ui/react-dropdown-menu`, exported from `@opensaas/stack-ui/primitives`.

```tsx
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from '@opensaas/stack-ui/primitives'

;<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="outline">View</Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuCheckboxItem checked={showDrafts} onCheckedChange={setShowDrafts}>
      Show drafts
    </DropdownMenuCheckboxItem>
  </DropdownMenuContent>
</DropdownMenu>
```

`ListViewClient` gains `availableColumns` and `columnsChosen`. New slots: `list-view-toolbar`, `list-view-sort`, `list-view-columns`, `list-view-density`, `list-view-table` (with `data-density`), `list-view-pagination`, `list-view-page-size`, and `dropdown-menu-*` on the primitive.
