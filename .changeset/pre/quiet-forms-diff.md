---
'@opensaas/stack-ui': patch
---

The item form's update now sends only the fields whose value changed from what it loaded, and issues no update when nothing changed, so lists whose hooks guard system-managed fields can be edited from the admin.
