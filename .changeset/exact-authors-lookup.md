---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Look up a relationship record in the Filter builder and filter to exactly that record

Choosing a to-one relationship field in the admin list's Filter builder now lists the first page of its records and searches them as you type. Picking one writes `field:#id`: the chip shows the record's Item label while the URL carries its id. Typing without picking still writes label text, shown as "contains". A `#id` the related list cannot hold is shown as the free text the list searches for. A to-many count Cell links to the other list filtered to that row, so an admin can go from an author to all their posts.

```text
/admin/post?search=author:#0190a3c2-7b1e-7000-8000-000000000001
```

`FilterSpec` gains an optional `toIdCondition(id)`, and `FilterFieldSuggestion` an optional `matchesById`. The built-in to-one relationship lowers `#id` through the relation, never the foreign key column, so the related list's `query` access applies and a record the session cannot read matches nothing. The id is parsed with `parseListId` for the related list's id strategy, and an id it cannot hold degrades to free text:

```ts
getFilterSpec: (fieldName, listKey, config) => ({
  // ...
  toIdCondition: (id) => {
    const parsed = parseListId(config, 'User', id)
    return parsed.ok ? { [fieldName]: { some: { id: { equals: parsed.value } } } } : null
  },
})
```

Core exports `filterTokenRecordId(token)`, `recordIdFilterToken(field, id)` and `isFieldFilterableById(...)`, and the `relationshipOptions` server action answers `{ options, searched }`, where `searched` says whether `search` narrowed the options. `FilterBuilder` takes optional `listKey`, `serverAction` and `recordLabels` props, and the list view resolves the labels server-side through the secured context. Without a `serverAction`, a relationship field takes typed label text only. Cells receive an optional `href`.

Meaning change: on a field with `toIdCondition`, an unquoted value starting with `#` is now an id. A bookmarked `author:#abc` that used to mean "author's label contains #abc" now means the record with id `abc`, or free text when `abc` is not a valid id. Quote it (`author:"#abc"`) to keep the label search.
