---
'@opensaas/stack-cli': minor
---

MCP feature wizards now generate current-API code for all five features

- `comments`, `file-upload`, and `semantic-search` wizards previously returned "coming soon" stubs — they now generate real config (Comment list with moderation/threading, storage config with local/S3/R2/Vercel Blob providers, ragPlugin with OpenAI or Ollama embeddings and `searchable()` fields).
- The `authentication` wizard output was rewritten to the current API: `authPlugin` with `socialProviders`/`extendUserList`/`access` (ADR-0013), the required `prismaClientConstructor`, `SignInForm`/`SignUpForm` with the `authClient` prop, and `lib/auth.ts` wiring via `createAuth(config, rawOpensaasContext)`.
- The `blog` wizard now emits valid `select()` options, wires Category/Tag relationships on both sides, and uses filter-based query access.
- `opensaas mcp start` no longer prints its startup banner to stdout, which corrupted the MCP stdio JSON-RPC stream.
- Removed unsupported options from wizard catalogs (Cohere/Anthropic embeddings, magic links) and fixed the docs provider's field-type guidance (`json()` mapping, `getPrismaType` modifiers).
