---
'@opensaas/stack-ui': minor
'create-opensaas-app': patch
---

`serializeFieldConfigs` now takes the context and the list key, and applies the session's Session vocabulary

Field configs can no longer reach a client without the session applied. The serialiser on `@opensaas/stack-ui/server` reads the vocabulary itself: a field the session can never read is withheld, and a field it can never write for the form's operation is marked read-only. A rule that reads the row keeps its field editable when there is no row to answer it for, so a create rule written as `item?.ownerId === session.userId` no longer locks the field on a create form (#2383).

```tsx
// app/posts/new/page.tsx (server)
import { serializeFieldConfigs } from '@opensaas/stack-ui/server'
import { getContext } from '@/.opensaas/context'

const context = await getContext(session)
const fields = await serializeFieldConfigs(context, 'Post', 'create') // or 'update', or 'display' (default)
```

An edit form's values come from `serializeItemForForm`, also on `@opensaas/stack-ui/server`. It applies each field's `ui.valueForClientSerialization` (a `password()` field becomes `{ isSet }`) and leaves out every field the serialiser withholds:

```tsx
const editFields = await serializeFieldConfigs(context, 'Post', 'update', post) // answers row-dependent rules for `post`
const initialData = await serializeItemForForm(context, 'Post', post.id)
if (initialData === null) notFound()
```

```tsx
// a 'use client' component
<ItemCreateForm fields={fields} onSubmit={createPost} />
<ItemEditForm fields={editFields} initialData={initialData} onSubmit={updatePost} />
```

`ItemCreateForm` and `ItemEditForm` take the serialised result and no longer serialise on the client: their `fields` prop is `Record<string, SerializableFieldConfig>`, and the `listKey` and `config` props are gone (the serialiser marks the non-owning end of a one-to-one itself). `serializeFieldConfig` (singular) is no longer exported. `ItemEditForm` no longer applies a field's `ui.valueForClientSerialization` to `initialData`; pass it `serializeItemForForm`'s result. Its `TData` type parameter now extends `Record<string, unknown>`.

The admin's item forms read the same vocabulary, so a field whose write rule throws is now read-only rather than editable, a field on a list whose `update` operation the session is denied is read-only on the edit form, and per-row edit gating is preserved: on the edit form, a field whose update rule reads the row is answered through core against the row being edited as stored, as the update decides it, and is read-only on a row the rule denies (#1402). A rule that reaches for a relation off `item` is read-only, because the update itself rejects it: the stored row carries no relation. A field whose `read` rule depends on the row stays on the edit form, and its value is whatever the form's own secured read returned, Field Visibility applied. On a list the session may create but not query, an editable relationship field keeps its options on the create form.
