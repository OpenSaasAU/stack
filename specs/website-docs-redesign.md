# Website & Docs Redesign

Design spec for the public site (`docs/` app, deployed at https://stack.opensaas.au/). Decisions below were settled in a grilling session; vocabulary is canonical in `CONTEXT.md` (§ Website & docs). The IA decision is recorded in ADR-0019.

## Decisions (settled)

| Decision      | Outcome                                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Core story    | **Guardrails story**: AI agents ship fast but can't be trusted with security; Stack makes the secure path the only path.                       |
| Audience      | Developers already building with AI coding agents. Technical copy from sentence one.                                                           |
| Naming        | **"Stack"** in copy and wordmark, "by OpenSaas" attribution. Packages/org keep full names.                                                     |
| Site shape    | One **Narrative landing** page; everything else lives in docs.                                                                                 |
| Proof devices | **Session switcher** (interactive, precomputed, honestly labeled) + real admin UI screenshots.                                                 |
| Visual        | Dark-first dev aesthetic on the landing; docs fully readable in light and dark. Tailwind stays.                                                |
| Docs IA       | Full **Diátaxis** restructure: Tutorials / How-to / Concepts / Reference. Old URLs get permanent redirects (ADR-0019).                         |
| Tutorial      | **Flagship tutorial**: build a small real app by describing features to Claude Code, anchored by **Checkpoints** (canonical config snapshots). |
| Packages      | Per-package pages live under Reference; conceptual/setup material redistributed to Concepts/How-to.                                            |
| Agent naming  | Generic pain ("AI coding agents"), Claude Code named as the first-class workflow and the tutorial's agent.                                     |
| Beta          | Understated badge + one honest "pin versions for production" line in the get-started section. No banner.                                       |
| Keystone      | One slim "Coming from Keystone?" strip near the end of the landing narrative, linking to the migration how-to.                                 |

## Narrative landing (`docs/app/page.tsx`)

One scroll, dark-first, in this order:

1. **Hero** — wordmark "Stack" (+ Beta badge, "by OpenSaas"), headline carrying the Guardrails story, install command (`npm create opensaas-app@latest my-app`), CTAs → tutorial + docs.
2. **The pain** — agents multiply feature velocity; security review doesn't scale with it. Short, declarative.
3. **The turn** — one config; access control enforced on every `context.db` operation; denied reads return `null`/`[]` (Silent failure). Config snippet.
4. **Session switcher** — same query, switch who's asking (Anonymous / Author / Another user); rows visibly scope, a denied update returns `null`. Client component over precomputed results, labeled as such.
5. **How it works** — config → generated Prisma schema, types, secured context, admin UI. Compact 4-step strip.
6. **Admin UI** — screenshots (existing `docs/public/images/ui-*.png`) in a browser frame; regenerate dark-theme variants if feasible.
7. **Claude-first workflow** — shipped `CLAUDE.md`, MCP tools, Claude Code plugin; "describe a feature" flow.
8. **Keystone strip** — slim: Keystone-compat schema generation + migration guide link.
9. **Get started** — install command again, beta honesty line, links into docs.

## Design system

- Tailwind (existing setup). Landing sections render on a near-black surface with a single strong accent; allow/deny states in the Session switcher use green/red semantics.
- Docs keep the current readable layout, restyled tokens only; full `prefers-color-scheme` support stays.

## Docs IA (Diátaxis) and URL map

New top-level: `/docs` (landing) · Tutorials · How-to guides · Concepts · Reference. `lib/navigation.ts` mirrors this. All old URLs → permanent redirects in `docs/next.config.js`.

| Old                                  | New                                                             |
| ------------------------------------ | --------------------------------------------------------------- |
| /docs/quick-start                    | /docs/tutorials/quick-start                                     |
| /docs/getting-started                | /docs/how-to/installation                                       |
| —                                    | /docs/tutorials/build-with-claude-code (new, Flagship tutorial) |
| /docs/core-concepts/access-control   | /docs/concepts/access-control                                   |
| /docs/core-concepts/field-types      | /docs/concepts/field-types                                      |
| /docs/core-concepts/fields           | /docs/concepts/fields                                           |
| /docs/core-concepts/queries          | /docs/concepts/queries                                          |
| /docs/core-concepts/hooks            | /docs/concepts/hooks                                            |
| /docs/core-concepts/generators       | /docs/concepts/generators                                       |
| /docs/core-concepts/config           | /docs/concepts/config                                           |
| /docs/guides/migrating-from-keystone | /docs/how-to/migrate-from-keystone                              |
| /docs/guides/migration               | /docs/how-to/migrate                                            |
| /docs/guides/claude-code             | /docs/how-to/claude-code                                        |
| /docs/guides/custom-fields           | /docs/how-to/custom-fields                                      |
| /docs/guides/theming                 | /docs/how-to/theming                                            |
| /docs/guides/theme-presets           | /docs/how-to/theme-presets                                      |
| /docs/guides/storage-setup           | /docs/how-to/storage                                            |
| /docs/guides/composability           | /docs/how-to/composability                                      |
| /docs/guides/authentication          | /docs/how-to/authentication                                     |
| /docs/guides/plugins                 | /docs/how-to/write-a-plugin                                     |
| /docs/guides/mcp-setup               | /docs/how-to/mcp                                                |
| /docs/guides/rag-setup               | /docs/how-to/rag                                                |
| /docs/guides/rag-advanced            | /docs/how-to/rag-advanced                                       |
| /docs/guides/deployment              | /docs/how-to/deploy                                             |
| /docs/packages/core                  | /docs/reference/core                                            |
| /docs/packages/auth                  | /docs/reference/auth                                            |
| /docs/packages/rag                   | /docs/reference/rag                                             |
| /docs/packages/storage               | /docs/reference/storage                                         |
| /docs/packages/ui                    | /docs/reference/ui                                              |
| /docs/packages/tiptap                | /docs/reference/tiptap                                          |
| /docs/api-reference/config           | /docs/reference/config-api                                      |
| /docs/api-reference/fields           | /docs/reference/fields-api                                      |
| /docs/api-reference/context          | /docs/reference/context-api                                     |

How-to nav grouping: **Set up** (installation, claude-code) · **Build** (custom-fields, composability, theming, theme-presets, write-a-plugin) · **Integrate** (authentication, storage, mcp, rag, rag-advanced) · **Migrate** (migrate-from-keystone, migrate) · **Deploy** (deploy).

Content edits in this pass: a docs landing page (orientation + quadrant cards + start-here path); Concepts openings reworked so Access Control leads with the story and adopts the CONTEXT.md vocabulary; page intros adjusted to match their quadrant's job. Deep per-page rewrites beyond that are follow-up work.

Internal links: update root `README.md`, package READMEs, and cross-links inside `docs/content/**` to the new URLs (redirects cover the wild, not our own tree).

## Flagship tutorial (outline)

`/docs/tutorials/build-with-claude-code` — _Build a team blog with Stack and Claude Code._

1. Scaffold (`npm create opensaas-app@latest team-blog`), open in Claude Code.
2. Describe the posts feature (drafts/published, authors) — **Checkpoint 1**: canonical config.
3. Ask for access rules (anonymous sees published only; authors edit their own) — **Checkpoint 2**.
4. Prove the guardrail: query as anonymous, watch drafts disappear; denied update returns `null`.
5. Add comments by description — **Checkpoint 3**.
6. Tour the generated admin UI.
7. Where to next (Concepts, How-to).

Checkpoints keep the tutorial truthful despite agent variance: "your config should now look like this."

## Execution checklist

- [ ] ADR-0019 (done) and this spec
- [ ] Landing page + Session switcher + design tokens
- [ ] Content tree moves + navigation.ts + redirects
- [ ] Docs landing page
- [ ] Flagship tutorial
- [ ] Concepts/intro reworks; internal + README link updates
- [ ] `pnpm lint`, `pnpm manypkg fix`, `pnpm format`; `pnpm build` in docs/; link-check script
