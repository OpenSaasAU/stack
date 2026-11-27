---
'@opensaas/stack-ui': minor
'create-opensaas-app': patch
---

Save on an admin edit page now stays on the item

**Save** writes the changed fields and stays on the item, showing "Saved." in the admin's notice. A new **Save and close** button keeps the old behaviour of returning to the list with "Changes saved". Pressing Enter in a field saves and stays. Creating a new item and saving a singleton are unchanged.

`ItemFormClient` also takes `itemLabel`, which names the item in its delete confirmation:

```tsx
<ItemFormClient listKey="Post" urlKey="post" mode="edit" itemLabel="Hello world" {...props} />
```
