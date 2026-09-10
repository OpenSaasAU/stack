import { getContext } from '@/.opensaas/context'
import type { KnowledgeBaseCreateInput } from '@/.opensaas/types'

const sampleArticles: KnowledgeBaseCreateInput[] = [
  {
    title: 'What is OpenSaas Stack?',
    content: `OpenSaas Stack is a Next.js-based framework for building admin-heavy applications with built-in access control. It uses a config-first approach similar to KeystoneJS but modernized for Next.js App Router and designed to be AI-agent-friendly with automatic security guardrails. The stack includes core packages for configuration, authentication, UI components, and specialized integrations like RAG (Retrieval-Augmented Generation). It's built as a pnpm monorepo with packages for core functionality, CLI tools, admin UI, authentication, and various integrations. OpenSaas Stack emphasizes type safety, automatic code generation, and developer experience.`,
    category: 'ai-ml',
    published: true,
  },
  {
    title: 'OpenSaas Stack Access Control System',
    content: `The access control system is OpenSaas Stack's primary innovation. It automatically secures every database operation: context.db is a secured surface over the ORM rather than the ORM itself. Access control has three levels: operation-level (controls query/create/update/delete), field-level (controls which fields are readable/writable), and filter-based (scopes which records are accessible). Users define access rules in opensaas.config.ts using AccessControl functions. Operations return null or empty arrays on denial rather than throwing errors, preventing information leakage. The engine ANDs a filter-returning rule into the read's own predicate in the same query, so a terminal like nearest() ranks inside the scoped set rather than filtering a ranked one. The deliberate bypass is context.unsafe, which skips the access filter, field visibility, hooks and error normalisation alike — reaching for it is a visible act, and the call site should say why.`,
    category: 'ai-ml',
    published: true,
  },
  {
    title: 'OpenSaas Stack Plugin System',
    content: `OpenSaas Stack uses a powerful plugin system for extending functionality. Plugins can inject lists, add hooks, register MCP tools, and participate in code generation. The system features dependency resolution through topological sorting, deep merging of configurations, and lifecycle hooks (beforeGenerate, afterGenerate). Key plugins include authPlugin for Better-auth integration and ragPlugin for vector embeddings and semantic search. Plugins have an init function that receives a context for adding or extending lists, and can store runtime data in config._pluginData. This architecture enables clean composition and third-party extensions without modifying core code.`,
    category: 'web-dev',
    published: true,
  },
  {
    title: 'Building Lists in OpenSaas Stack',
    content: `Lists are the fundamental building blocks in OpenSaas Stack, representing database tables with fields, access control, and hooks. Each list is defined in opensaas.config.ts with PascalCase names (e.g., BlogPost, User). Lists contain fields (like text, integer, relationship), access control rules at operation and field levels, and hooks for data transformation and side effects. The stack automatically generates the database contract, TypeScript types, and Zod validation schemas from list definitions; there is no Prisma schema file. The one column added for you is id; createdAt and updatedAt are not, because auto-timestamps are off by default (ADR-0004) — a list opts in by declaring the two fields itself or by setting db: { timestamps: true }, per list or on db for every list at once. Lists support relationships using the ref format (e.g., 'Post.author'). The generated context provides type-safe database access with automatic access control enforcement.`,
    category: 'web-dev',
    published: true,
  },
  {
    title: 'OpenSaas Stack Field Types',
    content: `OpenSaas Stack provides core field types including text, integer, checkbox, timestamp, password, select, and relationship. Each field type is fully self-contained. A field builder describes itself through getZodSchema (validation) and getContractField, which returns a ContractFieldDescriptor: the stored column as a pack-qualified type constructor such as { pack: 'pg', type: 'text' } with its nullability and column mapping, or a kind: 'columns' descriptor when one logical field owns several columns, a kind: 'relation' descriptor for a relationship, or kind: 'computed' for a field that stores nothing, such as a virtual field. Where the TypeScript face differs from what the column's codec already gives it, the builder declares it as the outputType and inputType values rather than as a method; a field with no single column to be typed from — kind: 'computed' or kind: 'columns' — must declare outputType, while inputType stays optional everywhere. Fields support validation rules like isRequired, length constraints, and min/max values. Delegating to these members keeps generation logic in the fields rather than in switch statements. Third-party packages can add custom field types by implementing the BaseFieldConfig interface. Fields can specify UI options that are automatically passed to admin components. The searchable() wrapper from @opensaas/stack-rag automatically adds embedding fields for semantic search.`,
    category: 'web-dev',
    published: true,
  },
  {
    title: 'OpenSaas Stack Hooks System',
    content: `The hooks system in OpenSaas Stack provides data transformation and side effects during database operations. Hooks are available at list and field levels. Data transformation hooks include resolveInput (transform data going in) and resolveOutput (transform data coming out). Side effect hooks include beforeOperation and afterOperation for actions without modifying data. There's also validateInput for custom validation logic. Hook execution order for writes: list resolveInput, field resolveInput, validateInput, field validation, access control, beforeOperation hooks, database operation, then afterOperation hooks — all inside the write's own transaction. afterTransaction runs after that transaction commits, and is where work that must not hold a database connection belongs: the RAG plugin generates embeddings there, because calling an embedding provider is a network round trip. For reads: database operation, access control, field resolveOutput — there is no afterOperation on the read path, only on create, update and delete. Common use cases include hashing passwords, auto-setting timestamps, sending notifications, and cache invalidation.`,
    category: 'web-dev',
    published: true,
  },
  {
    title: 'OpenSaas Stack Code Generation',
    content: `OpenSaas Stack uses code generators to convert opensaas.config.ts into a database contract and TypeScript types. Running 'pnpm generate' emits the Contract module and its artifacts, .opensaas/types.ts with TypeScript types, and a contract space under migrations/ for each extension pack the config declares; it writes no app migration of its own, which is what 'prisma migration plan' does. Generators delegate to field builder methods rather than using switch statements, making the system fully extensible. The generated context factory (.opensaas/context.ts) abstracts Prisma client management and provides getContext() for creating access-controlled database contexts. Plugins can hook into generation with beforeGenerate and afterGenerate lifecycle methods. The datasource is PostgreSQL only, and a config declares extension packs rather than a client constructor.`,
    category: 'software-eng',
    published: true,
  },
  {
    title: 'OpenSaas Stack Authentication with Better-auth',
    content: `OpenSaas Stack provides optional Better-auth integration through @opensaas/stack-auth. The authPlugin automatically injects auth lists (User, Session, Account, Verification) and configures Better-auth with email/password and OAuth support. The config wrapper merges auth lists with user-defined lists and manages session fields. Better-auth handles OAuth flows and session management, while the context automatically includes session data in all access control functions. The stack provides pre-built UI components (SignInForm, SignUpForm) and client-side hooks (useSession). Session fields are configurable to include userId, email, name, role, and custom fields. Auth setup requires minimal configuration - just add authPlugin to your config.`,
    category: 'software-eng',
    published: true,
  },
  {
    title: 'OpenSaas Stack RAG Integration',
    content: `The RAG (Retrieval-Augmented Generation) package (@opensaas/stack-rag) adds vector embeddings and semantic search to OpenSaas Stack applications. It uses a plugin-based architecture with ragPlugin for configuration. There are two equivalent ways to declare a vector: the searchable() wrapper, which adds the companion embedding field for you, and embedding() written out, which is what lets the column declare its own dimensions, distanceFunction and index. Supported embedding providers include OpenAI (text-embedding-3-small, text-embedding-3-large) and Ollama for local embeddings; ollamaEmbeddings requires dimensions, because Ollama reports its output size only from a live embed call and the value is a column's type. Embeddings are stored in a native pgvector column, with their metadata in a jsonb column beside it, and search runs through nearest() on the secured read surface so the ranking and the access filter live in the same query. The column is a plugin output and is write-denied to application code by default: a create or update naming it throws unless the field sets allowManualWrites. ragPlugin declares the pgvector extension pack itself, so applying the contract enables the extension and there is no CREATE EXTENSION step and no install script. The package provides runtime utilities like semanticSearch(), generateEmbedding(), and chunkText(). The stored metadata includes model, provider, dimensions, and a source hash for change detection, which is what stops an unrelated field change from costing an API call.`,
    category: 'database',
    published: true,
  },
  {
    title: 'OpenSaas Stack MCP Server Integration',
    content: `OpenSaas Stack integrates with Model Context Protocol (MCP) servers through @opensaas/stack-core/mcp and @opensaas/stack-auth/mcp. Enable MCP in config with mcp.enabled and auth configuration. The core runtime automatically generates CRUD tools for each list (query, create, update, delete) that respect existing access control rules. The auth adapter provides session management from Better-auth OAuth flow with AI assistants. Custom tools can be added per-list for specialized operations. MCP enables AI assistants like Claude to interact with your application's data securely. The integration is auth-agnostic but works seamlessly with Better-auth. All MCP operations go through the same access control as regular app operations.`,
    category: 'database',
    published: true,
  },
  {
    title: 'OpenSaas Stack Admin UI Components',
    content: `The UI package (@opensaas/stack-ui) provides multiple abstraction levels through specialized exports. The full AdminUI component offers a complete admin interface with routing. Standalone components like ItemCreateForm, ItemEditForm, and ListTable can be dropped into custom pages. Primitives based on shadcn/ui (Button, Input, Dialog, Card, Table) enable building custom UIs. Composable field components (TextField, SelectField, RelationshipField) handle individual field rendering. The UI layer uses a component registry pattern to avoid switch statements. Custom field components can be registered globally or overridden per-field. Server utilities like getAdminContext handle authentication. The UI respects access control and automatically shows/hides fields based on permissions.`,
    category: 'devops',
    published: true,
  },
  {
    title: 'Creating Custom Field Types in OpenSaas Stack',
    content: `Custom field types in OpenSaas Stack are fully self-contained and don't require modifying core code. Define the field type as an intersection with BaseFieldConfig<TypeInfo>, then create a builder function implementing getZodSchema for validation and getContractField for the columns the field stores. getContractField returns a ContractFieldDescriptor and is what 'opensaas generate' reads to derive the contract. Declare outputType and inputType only where the field's TypeScript face differs from the column's own codec type. Of the two, only outputType is ever required: a field whose descriptor is kind: 'computed' (a virtual field) or kind: 'columns' has no single column to be typed from, so 'opensaas generate' refuses it without one. inputType is never required by the generator — on a single-column field its absence means the column's own input type — though a multi-column field should declare it alongside outputType for the same reason. For admin UI support, create a React component accepting standard field props (name, value, onChange, label, error) and register it with registerFieldComponent(). Third-party field packages like @opensaas/stack-tiptap demonstrate this pattern. Due to Next.js server/client boundaries, field components must be registered client-side with a 'use client' file imported in your admin page. FieldConfig is BaseFieldConfig itself rather than a closed union, so a field a third-party package builds is already a FieldConfig with no core modification.`,
    category: 'devops',
    published: true,
  },
  {
    title: 'OpenSaas Stack Context and Database Access',
    content: `The context is the primary interface for database operations in OpenSaas Stack. Generated automatically in .opensaas/context.ts, it provides getContext() for creating access-controlled database wrappers. Context must be used instead of the unsecured surface to ensure access control enforcement. Usage: 'const context = await getContext()' for anonymous access or 'await getContext({ userId: 'user-123' })' for authenticated access. Reads compose — context.db.Post.where({ ... }).orderBy(...).limit(10).all(), with .first() for one row, .aggregate() for a count and .nearest() for a vector ranking — and writes are create({ data }), update({ where: { id }, data }) and delete({ where: { id } }), relating records with connect: { id } on the side that owns the foreign key. Access rules are resolved into the query the engine builds rather than applied after it. Operations return null or empty arrays on denial (silent failures to prevent info leakage). The context builds its own client from the emitted contract; a config declares extension packs and a pool binding rather than a client constructor. All hooks, access control functions, and MCP tools receive context for database access.`,
    category: 'software-eng',
    published: true,
  },
  {
    title: 'OpenSaas Stack Naming Conventions',
    content: `OpenSaas Stack uses consistent case conventions across contexts. List names in config must be PascalCase (e.g., User, BlogPost, AuthUser). The stack automatically converts these: contract tables and the ORM collections beneath them keep the list name (BlogPost), context DB properties use the list name (context.db.BlogPost), and admin UI URLs use kebab-case (/admin/blog-post). Utility functions help with conversion: getUrlKey('BlogPost') returns 'blog-post' for URLs, and getListKeyFromUrl('blog-post') returns 'BlogPost' for parsing. Following these conventions ensures the code generation and admin UI work correctly. Never use lowercase or snake_case for list names.`,
    category: 'web-dev',
    published: true,
  },
  {
    title: 'OpenSaas Stack Development Workflow',
    content: `The typical development workflow in OpenSaas Stack: 1) Define lists in opensaas.config.ts with fields, access control, and hooks. 2) Run 'pnpm generate' to emit the contract and TypeScript types. 3) Reconcile the database with them by running 'pnpm dev', which generates and reconciles on boot and on every save of opensaas.config.ts; 'pnpm db:update' asks that running loop to apply a staged change and exits non-zero when no loop is listening, and a deployment has no loop at all, so it migrates with 'prisma migration plan' and 'prisma db migrate'. 4) Use context.db in server actions and API routes for database access. 5) Build custom UIs with standalone components or use the full AdminUI. 6) Test access control with different session objects. The monorepo structure has packages/core for the framework, packages/cli for generators, packages/ui for components, and examples/ for reference implementations. Changes to core require rebuilding with 'pnpm build'. Hot reload works for application code but not generated files - regenerate when config changes.`,
    category: 'software-eng',
    published: true,
  },
  {
    title: 'OpenSaas Stack Type Safety and TypeScript',
    content: `OpenSaas Stack is built with TypeScript and provides end-to-end type safety. The config system uses discriminated unions and generic types to ensure type-safe field definitions. Generated TypeScript types (.opensaas/types.ts) include list types, field types, and operation types. The generated getContext is generic in the session type — 'await getContext<MySession>(session)' — and every list's surface is keyed by the emitted contract, so a read's row type follows the columns it selected. Field builders return typed objects carrying getZodSchema and getContractField, plus outputType and inputType values for the TypeScript face — both optional on the builder type, though a field with no single column to be typed from (kind: 'computed' or kind: 'columns') must declare outputType. Access control functions receive typed session objects. The project uses ESM with 'type: module' in package.json, requiring .js extensions on imports. TypeScript config uses moduleResolution: bundler and module: ESNext. Strict mode is enabled to catch errors early.`,
    category: 'web-dev',
    published: true,
  },
  {
    title: 'OpenSaas Stack Relationships and Foreign Keys',
    content: `Relationships in OpenSaas Stack use a ref format to connect lists. The ref specifies 'ListName.fieldName' to establish bidirectional relationships. For one-to-many relationships: 'posts: relationship({ ref: "Post.author", many: true })' on User and 'author: relationship({ ref: "User.posts" })' on Post. The emitted contract declares the foreign keys and their onDelete/onUpdate actions. The relationship field type supports many-to-one, one-to-many, and one-to-one patterns. Access control applies to relationships - users must have access to both the source and target records, and a related record the reader cannot see reads back as null for a to-one and an empty array for a to-many rather than removing the parent row. Every to-one relationship reads as possibly null for that reason, so guard before dereferencing. Relate records with connect: { id } on the side that owns the foreign key; there are no nested writes and no disconnect - clearing a to-one is writing null. The admin UI provides relationship pickers for selecting related items. Circular references are supported. Relationships respect the same PascalCase naming conventions as lists.`,
    category: 'database',
    published: true,
  },
  {
    title: 'OpenSaas Stack Error Handling and Silent Failures',
    content: `OpenSaas Stack implements silent failures for security. Access-controlled operations return null for single records or empty arrays for multiple records when access is denied, rather than throwing errors. This prevents information leakage about whether records exist. Applications must check for null: 'if (!post) { return { error: "Access denied" } }'. The distinction between "doesn't exist" and "no access" is intentionally blurred. Validation errors and database errors still throw normally. This pattern applies to all context.db operations. Tests should verify both successful access and denial scenarios. The admin UI handles null results gracefully by showing "Access denied" messages. Hooks can throw errors for validation failures, which are surfaced to users.`,
    category: 'software-eng',
    published: true,
  },
]

async function seed() {
  console.log('🌱 Seeding the knowledge base...\n')

  // sudo() bypasses access control and still runs every hook, which is what
  // gets past this list's `create: () => false` while leaving the RAG plugin's
  // embedding generation in place.
  const context = (await getContext()).sudo()

  try {
    // Clear first, so the seed re-runs from empty rather than refusing on a
    // populated database. An embedding is derived data: it is regenerated from
    // the article text below, never carried over.
    const existing = await context.db.KnowledgeBase.all()
    for (const article of existing) {
      await context.db.KnowledgeBase.delete({ where: { id: article.id } })
    }
    if (existing.length > 0) {
      console.log(`🗑️  Removed ${existing.length} existing article(s)\n`)
    }

    console.log(`📝 Creating ${sampleArticles.length} articles...\n`)

    for (const article of sampleArticles) {
      await context.db.KnowledgeBase.create({ data: article })
      console.log(`✅ Created: "${article.title}" (${article.category})`)
    }

    console.log(`\n✨ Created ${sampleArticles.length} articles.`)

    // The plugin embeds after each write's own transaction commits (ADR-0045),
    // so the columns fill in behind this loop rather than during it.
    console.log('\n⏳ Waiting for embeddings...')
    const deadline = Date.now() + 180_000
    let embedded = 0
    while (embedded < sampleArticles.length && Date.now() < deadline) {
      const rows = await context.db.KnowledgeBase.all()
      embedded = rows.filter((row) => row.contentEmbedding !== null).length
      if (embedded < sampleArticles.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
    console.log(`✅ ${embedded}/${sampleArticles.length} articles embedded`)

    if (embedded < sampleArticles.length) {
      throw new Error(
        'Some articles have no embedding. Check the dev server console for provider errors.'
      )
    }

    console.log('\n🎉 Seeding complete!')
  } catch (error) {
    console.error('\n❌ Seeding failed:', error)
    process.exit(1)
  }
}

seed()
  .then(() => {
    console.log('\n✅ Seed script completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Seed script failed:', error)
    process.exit(1)
  })
