---
'create-opensaas-app': patch
---

The `with-auth` template pins `Post.author` and `Note.owner` to the signed-in user with `access: { write: 'hooks' }`, so a user can no longer create, reassign or plant content under another user's name.
