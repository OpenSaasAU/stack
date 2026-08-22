---
'@opensaas/stack-core': minor
---

The derived MCP `query` tool now accepts an optional `fields` projection — the wire form of the runtime's existing fragment field selection — so an assistant can select scalars and nested relation fields (with `where`/`orderBy`/`take`/`skip`, and a to-many's row count) in a single call instead of following a foreign key with a second one. Omitting `fields` is unchanged, a bare read exactly as before.

```json
{
  "name": "list_post_query",
  "arguments": {
    "fields": {
      "title": true,
      "author": { "fields": { "name": true } },
      "comments": {
        "fields": { "text": true },
        "where": { "approved": { "equals": true } },
        "take": 5,
        "count": true
      }
    }
  }
}
```

The generated tool schema enumerates two levels of each list's own fields and relations, per session, and refuses (as an `isError` tool result, never a protocol error) anything it doesn't advertise — an unknown field, or a relation named a third level deep. See the ADR (`docs/adr/0033-mcp-tools-advertise-a-bounded-projection.md`) for the full design.

**Behaviour change:** `tools/list` is now evaluated per session. A list whose operation-level `query` access denies the session outright no longer appears in the tool listing at all — none of its four CRUD tools, and no relation entry elsewhere pointing at it. Previously every list's tools were listed regardless of session.
