import { getContext } from '@/.opensaas/context'

const sampleArticles = [
  {
    title: 'What is OpenSaas Stack?',
    content: `OpenSaas Stack is a Next.js-based framework for building admin-heavy applications with built-in access control. It uses a config-first approach similar to KeystoneJS but modernized for Next.js App Router and designed to be AI-agent-friendly with automatic security guardrails. The stack includes core packages for configuration, authentication, UI components, and specialized integrations like RAG (Retrieval-Augmented Generation). It's built as a pnpm monorepo with packages for core functionality, CLI tools, admin UI, authentication, and various integrations. OpenSaas Stack emphasizes type safety, automatic code generation, and developer experience.`,
    category: 'ai-ml',
    published: true,
  },
  {
    title: 'OpenSaas Stack Access Control System',
    content: `The access control system is OpenSaas Stack's primary innovation. It automatically secures all database operations through a context wrapper that intercepts Prisma queries. Access control has three levels: operation-level (controls query/create/update/delete), field-level (controls which fields are readable/writable), and filter-based (scopes which records are accessible). Users define access rules in opensaas.config.ts using AccessControl functions. Operations return null or empty arrays on denial rather than throwing errors, preventing information leakage. All operations must go through context.db instead of direct Prisma access to ensure security. The access control engine automatically merges filters with Prisma where clauses.`,
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
    content: `Lists are the fundamental building blocks in OpenSaas Stack, representing database tables with fields, access control, and hooks. Each list is defined in opensaas.config.ts with PascalCase names (e.g., BlogPost, User). Lists contain fields (like text, integer, relationship), access control rules at operation and field levels, and hooks for data transformation and side effects. The stack automatically generates Prisma schemas, TypeScript types, and Zod validation schemas from list definitions. System fields (id, createdAt, updatedAt) are added automatically. Lists support relationships using the ref format (e.g., 'Post.author'). The generated context provides type-safe database access with automatic access control enforcement.`,
    category: 'web-dev',
    published: true,
  },
  {
    title: 'OpenSaas Stack Field Types',
    content: `OpenSaas Stack provides core field types including text, integer, checkbox, timestamp, password, select, and relationship. Each field type is fully self-contained with methods for generating Zod schemas (validation), Prisma types (database), and TypeScript types. Fields support validation rules like isRequired, length constraints, and min/max values. The architecture uses builder pattern methods (getZodSchema, getPrismaType, getTypeScriptType) to delegate generation logic to fields rather than using switch statements. Third-party packages can add custom field types by implementing the BaseFieldConfig interface. Fields can specify UI options that are automatically passed to admin components. The searchable() wrapper from @opensaas/stack-rag automatically adds embedding fields for semantic search.`,
    category: 'web-dev',
    published: true,
  },
  {
    title: 'OpenSaas Stack Hooks System',
    content: `The hooks system in OpenSaas Stack provides data transformation and side effects during database operations. Hooks are available at list and field levels. Data transformation hooks include resolveInput (transform data going in) and resolveOutput (transform data coming out). Side effect hooks include beforeOperation and afterOperation for actions without modifying data. There's also validateInput for custom validation logic. Hook execution order for writes: list resolveInput, field resolveInput, validateInput, field validation, access control, beforeOperation hooks, database operation, then afterOperation hooks. For reads: database operation, access control, field resolveOutput, afterOperation. Common use cases include hashing passwords, auto-setting timestamps, sending notifications, and cache invalidation.`,
    category: 'web-dev',
    published: true,
  },
  {
    title: 'OpenSaas Stack Code Generation',
    content: `OpenSaas Stack uses code generators to convert opensaas.config.ts into Prisma schemas and TypeScript types. Running 'pnpm generate' creates prisma/schema.prisma with all models and .opensaas/types.ts with TypeScript types. Generators delegate to field builder methods rather than using switch statements, making the system fully extensible. The generated context factory (.opensaas/context.ts) abstracts Prisma client management and provides getContext() for creating access-controlled database contexts. Plugins can hook into generation with beforeGenerate and afterGenerate lifecycle methods. The system supports custom Prisma client constructors for specialized database drivers like Neon, Turso, or PlanetScale.`,
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
    content: `The RAG (Retrieval-Augmented Generation) package (@opensaas/stack-rag) adds vector embeddings and semantic search to OpenSaas Stack applications. It uses a plugin-based architecture with ragPlugin for configuration. The searchable() field wrapper automatically creates embedding fields and hooks for regeneration on content changes. Supported embedding providers include OpenAI (text-embedding-3-small, text-embedding-3-large) and Ollama for local embeddings. Storage backends include pgvector for PostgreSQL, sqlite-vss for SQLite, and JSON storage for development. The package provides runtime utilities like semanticSearch(), generateEmbedding(), and chunkText(). Embeddings are stored as JSON with metadata including model, provider, dimensions, and source hash for change detection.`,
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
    content: `Custom field types in OpenSaas Stack are fully self-contained and don't require modifying core code. Define the field type in config/types.ts extending BaseFieldConfig, create a builder function implementing getZodSchema (validation), getPrismaType (database), and getTypeScriptType (TypeScript types). For admin UI support, create a React component accepting standard field props (name, value, onChange, label, error) and register it with registerFieldComponent(). Third-party field packages like @opensaas/stack-tiptap demonstrate this pattern. Due to Next.js server/client boundaries, field components must be registered client-side with a 'use client' file imported in your admin page. The FieldConfig union includes BaseFieldConfig to allow custom types without core modifications.`,
    category: 'devops',
    published: true,
  },
  {
    title: 'OpenSaas Stack Context and Database Access',
    content: `The context is the primary interface for database operations in OpenSaas Stack. Generated automatically in .opensaas/context.ts, it provides getContext() for creating access-controlled database wrappers. Context must be used instead of direct Prisma access to ensure access control enforcement. Usage: 'const context = await getContext()' for anonymous access or 'await getContext({ userId: 'user-123' })' for authenticated access. The context wraps Prisma Client with interceptors that check access rules before every operation. Operations return null or empty arrays on denial (silent failures to prevent info leakage). Context supports custom Prisma client constructors for specialized database adapters. All hooks, access control functions, and MCP tools receive context for database access.`,
    category: 'software-eng',
    published: true,
  },
  {
    title: 'OpenSaas Stack Naming Conventions',
    content: `OpenSaas Stack uses consistent case conventions across contexts. List names in config must be PascalCase (e.g., User, BlogPost, AuthUser). The stack automatically converts these: Prisma models use PascalCase, Prisma Client properties use camelCase (prisma.blogPost), context DB properties use camelCase (context.db.blogPost), and admin UI URLs use kebab-case (/admin/blog-post). Utility functions help with conversion: getDbKey('BlogPost') returns 'blogPost' for database access, getUrlKey('BlogPost') returns 'blog-post' for URLs, and getListKeyFromUrl('blog-post') returns 'BlogPost' for parsing. Following these conventions ensures the code generation and admin UI work correctly. Never use lowercase or snake_case for list names.`,
    category: 'web-dev',
    published: true,
  },
  {
    title: 'OpenSaas Stack Development Workflow',
    content: `The typical development workflow in OpenSaas Stack: 1) Define lists in opensaas.config.ts with fields, access control, and hooks. 2) Run 'pnpm generate' to create Prisma schema and TypeScript types. 3) Run 'pnpm db:push' to update the database (or 'prisma migrate dev' for migrations). 4) Use context.db in server actions and API routes for database access. 5) Build custom UIs with standalone components or use the full AdminUI. 6) Test access control with different session objects. The monorepo structure has packages/core for the framework, packages/cli for generators, packages/ui for components, and examples/ for reference implementations. Changes to core require rebuilding with 'pnpm build'. Hot reload works for application code but not generated files - regenerate when config changes.`,
    category: 'software-eng',
    published: true,
  },
  {
    title: 'OpenSaas Stack Type Safety and TypeScript',
    content: `OpenSaas Stack is built with TypeScript and provides end-to-end type safety. The config system uses discriminated unions and generic types to ensure type-safe field definitions. Generated TypeScript types (.opensaas/types.ts) include list types, field types, and operation types. The context uses generic typing to preserve Prisma Client types: 'const context = await getContext<typeof prisma>(...)'. Field builders return typed objects with getZodSchema, getPrismaType, and getTypeScriptType methods. Access control functions receive typed session objects. The project uses ESM with 'type: module' in package.json, requiring .js extensions on imports. TypeScript config uses moduleResolution: bundler and module: ESNext. Strict mode is enabled to catch errors early.`,
    category: 'web-dev',
    published: true,
  },
  {
    title: 'OpenSaas Stack Relationships and Foreign Keys',
    content: `Relationships in OpenSaas Stack use a ref format to connect lists. The ref specifies 'ListName.fieldName' to establish bidirectional relationships. For one-to-many relationships: 'posts: relationship({ ref: "Post.author", many: true })' on User and 'author: relationship({ ref: "User.posts" })' on Post. Prisma automatically generates foreign keys and handles cascading. The relationship field type supports many-to-one, one-to-many, and one-to-one patterns. Access control applies to relationships - users must have access to both the source and target records. The admin UI provides relationship pickers for selecting related items. Generated types include the full relationship types from Prisma. Circular references are supported. Relationships respect the same PascalCase naming conventions as lists.`,
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
  console.log('🌱 Starting database seed...\n')

  const context = await getContext()

  try {
    // Check if articles already exist
    const existing = await context.db.knowledgeBase.count()

    if (existing > 0) {
      console.log(`⚠️  Database already contains ${existing} article(s). Skipping seed.`)
      console.log('   To re-seed, delete all articles first or drop the database.\n')
      return
    }

    console.log(`📝 Creating ${sampleArticles.length} articles...\n`)

    let created = 0
    for (const article of sampleArticles) {
      try {
        await context.db.knowledgeBase.create({
          data: article,
        })
        created++
        console.log(`✅ Created: "${article.title}" (${article.category})`)
      } catch (error) {
        console.error(`❌ Failed to create "${article.title}":`, error)
      }
    }

    console.log(`\n✨ Successfully created ${created}/${sampleArticles.length} articles!`)

    console.log('\n🎉 Seeding complete!')
    console.log(
      '\n💡 Note: Embeddings are automatically generated via the RAG plugin hooks.'
    )
    console.log(
      '   This may take a moment after creation. Check the contentEmbedding field.'
    )
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
