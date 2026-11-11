---
'@opensaas/stack-ui': minor
---

Typing a relationship field and text together in the Filter builder goes straight to the matching records

In the admin list's Filter builder, typing `author pri` into the empty bar now searches the Author field's records for "pri" and offers the matches first. Picking one writes `author:#<id>`, exactly as picking a record after choosing the field does. "Author contains pri" stays as the fallback, followed by the free-text search. The leading words name the field when they match a field's name or label, and the longest match wins. Nothing is looked up while the text could still be the start of a longer field's name (`author em` beside Author Email), and a wholly quoted search (`author "pri"`) searches the words inside the quotes. A field without a record lookup, a plain phrase such as `author is pri`, and a `field:value` token behave as before.

A to-one relationship field whose records can be picked now reads "is" and "is not" in its conditions instead of "contains" and "does not contain", matching the chip shown once a record is picked. Other relationship fields keep "contains" and "does not contain". Typed text that is not picked is still a contains match and its chip still reads "Author contains pri". The grammar and the URL are unchanged.

```text
author pri          → Priya Nair, Priya Nair-Reed, Author contains pri, Search all text…
/admin/post?search=author:#0190a3c2-7b1e-7000-8000-000000000001
```
