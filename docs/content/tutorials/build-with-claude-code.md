# Build with Claude Code

Take a scaffolded Stack app to a working team blog — real access rules, a comments feature, an admin — by describing what you want to Claude Code, and prove along the way that the access-control engine keeps every generated feature secure.

This is the workflow Stack is designed for: **you describe, the agent builds, the framework guards.**

**Time:** about 30 minutes.

## Prerequisites

- Node.js 18+ and pnpm (`npm install -g pnpm`)
- [Claude Code](https://claude.com/claude-code) installed (`npm install -g @anthropic-ai/claude-code`)
- No Stack knowledge required — that's what the tutorial is for

{% callout type="info" %}
**Agents vary.** Claude Code won't produce byte-identical code every run — that's expected. At each **Checkpoint** below you'll find the canonical config this tutorial depends on. If your generated code differs in structure, that's fine; if it differs in behavior, align it with the checkpoint before continuing.
{% /callout %}

## 1. Scaffold the app

Create a project with the AI development tooling included:

```bash
npm create opensaas-app@latest team-blog --with-ai
cd team-blog
```

The scaffolder installs dependencies, generates the schema, and creates a SQLite database for you. Start the dev server:

```bash
pnpm dev
```

Your app is at [http://localhost:3000](http://localhost:3000), and the generated admin UI is at [http://localhost:3000/admin](http://localhost:3000/admin). Leave it running.

## 2. Meet the guardrails

Before describing any features, look at what you're standing on:

- **`opensaas.config.ts`** — the single source of truth. The starter ships a `User` list and a `Post` list that already has a draft/published `status`, a `publishedAt` timestamp (auto-set by a hook when a post is first published), and an `internalNotes` field with field-level access.
- **`.opensaas/`** — generated from the config: TypeScript types and the `getContext()` factory. Application code talks to `context.db`, never to Prisma directly, and every `context.db` operation passes through the access-control engine.
- **`CLAUDE.md`** — the rules that teach Claude Code the framework: always go through the context, every list declares access control, denied operations fail silently.

That last file is the point of `--with-ai`: there is no unchecked path for the agent to take, and the agent has been told so.

Two things to notice in the config before we start:

1. The access helpers (`isSignedIn`, `isAuthor`, `isOwner`) are **placeholders** — they all `return true` so you can explore the starter without auth. Wiring them up is our first feature.
2. `session.getSession` is a mock that returns `null` — every visitor is anonymous for now. That's enough for this tutorial; the [Authentication guide](/docs/how-to/authentication) replaces it with Better-auth.

Under those placeholders sits a hard default worth knowing: the engine **denies by default**. A list with no access rules isn't open — it's inaccessible. Nothing in Stack ships readable by accident.

## 3. Make the access rules real

Open the project in Claude Code:

```bash
claude
```

Describe the security you want in plain language:

> Implement the access rules for real. Anonymous visitors can only see published posts; signed-in users can also see their own posts, drafts included. Creating a post requires being signed in. Only a post's author can update or delete it, and only the author can see or edit internalNotes. Keep user sign-up open, but only let users update or delete their own record. Sessions carry a userId.

Claude will rewrite the helper functions and access blocks, then run `pnpm generate`. Check the result against the checkpoint.

### Checkpoint 1 — the access rules

The helpers should now use the session for real — equivalent to:

```typescript
const isSignedIn: AccessControl = ({ session }) => !!session?.userId

// As an operation rule this returns a row *filter*, so non-authors
// don't get an error — they simply match nothing.
const isAuthor: AccessControl = ({ session }) =>
  session?.userId ? { authorId: { equals: session.userId } } : false

const isOwner: AccessControl = ({ session }) =>
  session?.userId ? { id: { equals: session.userId } } : false

// Field-level rules are boolean-only — they decide per fetched item,
// they can't scope rows. So internalNotes gets its own helper:
const isAuthorOfItem: AccessControl = ({ session, item }) =>
  !!session?.userId && item?.authorId === session.userId
```

With `internalNotes` using the boolean helper:

```typescript
internalNotes: text({
  ui: { displayMode: 'textarea' },
  access: {
    read: isAuthorOfItem,
    create: isSignedIn,
    update: isAuthorOfItem,
  },
}),
```

{% callout type="warning" %}
**Operation rules may return filters; field rules must return booleans.** It's the one sharp edge in the access API, and the reason the checkpoint uses two helpers. An agent that reuses the filter-returning `isAuthor` on a field would get "allow" — filters aren't meaningful there.
{% /callout %}

And the `Post` list's operation access should be equivalent to:

```typescript
access: {
  operation: {
    // Anonymous: published only. Signed in: published + your own.
    query: ({ session }) =>
      session?.userId
        ? {
            OR: [
              { status: { equals: 'published' } },
              { authorId: { equals: session.userId } },
            ],
          }
        : { status: { equals: 'published' } },
    create: isSignedIn,
    update: isAuthor,
    delete: isAuthor,
  },
},
```

Notice what these rules are: **not** middleware, **not** per-route checks — data rules, declared once, that the engine merges into every operation. A rule returns a boolean (allow/deny the operation) or a Prisma filter (scope which rows it can touch).

Refresh `/admin`: with the mock session still `null`, the admin now shows **only published posts** — the admin UI runs through the same secured context as everything else, so it can never show a session more than the rules allow.

## 4. Try to break it

Rules only count if they hold when code — anyone's code, any agent's code — comes at the database from a new direction. Create `guardrails-check.ts` in the project root:

```typescript
import { getContext } from './.opensaas/context'

async function main() {
  // Seed with sudo(): access control bypassed, for exactly this kind of
  // trusted script — never for request handling.
  const seed = (await getContext()).sudo()
  const alice = await seed.db.user.create({
    data: { name: 'Alice', email: 'alice@example.com', password: 'correct-horse' },
  })
  const bob = await seed.db.user.create({
    data: { name: 'Bob', email: 'bob@example.com', password: 'battery-staple' },
  })
  await seed.db.post.create({
    data: {
      title: 'Hello world',
      slug: 'hello-world',
      status: 'published',
      author: { connect: { id: alice.id } },
    },
  })
  const draft = await seed.db.post.create({
    data: {
      title: 'Secret draft',
      slug: 'secret-draft',
      status: 'draft',
      author: { connect: { id: alice.id } },
    },
  })

  // Read as three different callers.
  const anonymous = await getContext()
  const asAlice = await getContext({ userId: alice.id })
  const asBob = await getContext({ userId: bob.id })

  const show = (posts: { title: string }[]) => posts.map((p) => p.title).join(', ')
  console.log('anonymous sees:', show(await anonymous.db.post.findMany()))
  console.log('alice sees:    ', show(await asAlice.db.post.findMany()))
  console.log('bob sees:      ', show(await asBob.db.post.findMany()))

  // Bob attacks Alice's draft.
  const stolen = await asBob.db.post.update({
    where: { id: draft.id },
    data: { title: 'Bob was here' },
  })
  console.log("bob updating alice's draft returns:", stolen)
}

main()
```

Run it:

```bash
npx tsx guardrails-check.ts
```

You should see:

```
anonymous sees: Hello world
alice sees:     Hello world, Secret draft
bob sees:       Hello world
bob updating alice's draft returns: null
```

Three things worth staring at:

1. **Nobody filtered anything in application code.** The same `findMany()` returned different rows per caller, because the engine merged each session's access filter into the query before it hit the database.
2. **Bob's attack returns `null`, not an error.** This is [silent failure](/docs/concepts/access-control#silent-failures): a denied operation is indistinguishable from "not found", so Bob can't even probe whether Alice's draft exists.
3. **`internalNotes` never leaves the server** for anyone but the author — field-level access strips it from reads after the rows come back.

Ask Claude Code to write a feature that leaks drafts, if you like. Its code will route through `context.db` — the `CLAUDE.md` tells it to, and there's no other wired path — and the engine will scope whatever it writes.

## 5. Add comments — by description

Now that you trust the loop, add a whole feature in one prompt:

> Add comments. A comment has a required text body, an author (a User), and belongs to a post. Anyone can read comments; signed-in users can create them; only a comment's author can edit or delete it.

Claude adds the list, regenerates, and pushes the schema. Check the checkpoint:

### Checkpoint 2 — the Comment list

```typescript
Comment: list<Lists.Comment.TypeInfo>({
  fields: {
    body: text({ validation: { isRequired: true } }),
    author: relationship({ ref: 'User' }),
    post: relationship({ ref: 'Post.comments' }),
  },
  access: {
    operation: {
      query: () => true,
      create: isSignedIn,
      update: isAuthor,
      delete: isAuthor,
    },
  },
}),
```

(Your `Post` list gains `comments: relationship({ ref: 'Comment.post', many: true })`.)

Note what the agent had to do to ship this: declare access rules, because **every list needs them** — a `Comment` list without an access block would be inaccessible, not open. The framework turned "add comments" into a decision about who may do what, and the config records the answer.

Refresh `/admin`: Comments appear in the navigation with list, create, and edit views. Nobody wrote admin UI code.

## 6. Tour the admin you didn't build

Spend a minute in `/admin`:

- **List views with filtering** — filter Posts by `status is draft`; filter state lives in the URL, so a filtered view is shareable
- **Edit forms generated per field type** — the status segmented control, the relationship picker for author, the textarea for content
- **The same access rules everywhere** — you saw it in step 3: the admin shows a session exactly what the engine allows, nothing more

The admin is composable, too: keep the full UI, or pull individual pieces (`ItemCreateForm`, `ListTable`, shadcn-based primitives) into your own pages. See [Composability](/docs/how-to/composability).

## Where you are

In half an hour you have:

- Access rules that scope reads and writes per session — described in one prompt, declared once, enforced on every operation
- Proof the rules hold against code that wasn't written with them in mind
- A comments feature added by description, with its own access rules because the framework insists
- An admin UI you never built, bound by the same engine

## Where to next

- **[Access Control](/docs/concepts/access-control)** — how the engine works: operation vs. field level, filters, silent failure
- **[Add Authentication](/docs/how-to/authentication)** — replace the mock session with Better-auth (`--with-auth` scaffolds it from the start)
- **[Claude Code Workflow](/docs/how-to/claude-code)** — the plugin, MCP tools, and feature wizards behind the prompts you just used
- **[Deploy to Production](/docs/how-to/deploy)** — Vercel + Postgres in ~15 minutes
