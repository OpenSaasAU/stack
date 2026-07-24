/**
 * Feature generator - Generates code, config, and documentation for features
 *
 * Emitted code must match the current stack APIs. Canonical references:
 * - examples/starter-auth (authPlugin, access helpers, lib/auth wiring)
 * - examples/file-upload-demo (storage config, file/image fields)
 * - examples/rag-openai-chatbot and examples/rag-ollama-demo (ragPlugin, searchable)
 */

import type { Feature, FeatureImplementation, GeneratedFile } from '../types.js'

const SQLITE_DB_BLOCK = `db: {
    provider: 'sqlite',
    prismaClientConstructor: (PrismaClient) => {
      const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' })
      return new PrismaClient({ adapter })
    },
  }`

const POSTGRES_DB_BLOCK = `db: {
    provider: 'postgresql',
    prismaClientConstructor: (PrismaClient) => {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
      const adapter = new PrismaPg(pool)
      return new PrismaClient({ adapter })
    },
  }`

export class FeatureGenerator {
  constructor(
    private feature: Feature,
    private answers: Record<string, string | boolean | string[]>,
    private followUpAnswers: Record<string, string | boolean | string[]>,
  ) {}

  /**
   * Generate complete feature implementation
   */
  generate(): FeatureImplementation {
    const featureType = this.feature.id

    switch (featureType) {
      case 'authentication':
        return this.generateAuthentication()
      case 'blog':
        return this.generateBlog()
      case 'comments':
        return this.generateComments()
      case 'file-upload':
        return this.generateFileUpload()
      case 'semantic-search':
        return this.generateSemanticSearch()
      default:
        throw new Error(`Unknown feature type: ${featureType}`)
    }
  }

  /**
   * Generate authentication feature
   */
  private generateAuthentication(): FeatureImplementation {
    const authMethods = this.answers['auth-methods'] as string[]
    const hasRoles = this.answers['user-roles'] as boolean
    const roles = hasRoles
      ? (this.followUpAnswers['user-roles_followup'] as string)
          ?.split(',')
          .map((r) => r.trim()) || ['admin', 'user']
      : null
    const userFields = (this.answers['user-fields'] as string[]) || []
    const emailVerification = this.answers['email-verification'] as boolean

    const hasGoogle = authMethods.includes('Google OAuth')
    const hasGithub = authMethods.includes('GitHub OAuth')
    const hasOAuth = hasGoogle || hasGithub
    const hasPassword = authMethods.includes('Email & Password')

    // Custom User fields go through authPlugin's extendUserList — the plugin
    // auto-generates the User/Session/Account/Verification lists. Passwords
    // live on the Account list managed by Better-auth; never add a password
    // field to User.
    const extendFields: string[] = []

    if (hasRoles && roles) {
      const options = roles.map(
        (r) => `{ label: '${r[0].toUpperCase()}${r.slice(1)}', value: '${r}' }`,
      )
      extendFields.push(
        `role: select({ options: [${options.join(', ')}], defaultValue: '${roles[roles.length - 1]}' })`,
      )
    }
    if (userFields.includes('Avatar')) {
      extendFields.push(`avatar: text() // or an image() field — see the file-upload feature`)
    }
    if (userFields.includes('Bio')) {
      extendFields.push(`bio: text({ ui: { displayMode: 'textarea' } })`)
    }
    if (userFields.includes('Phone')) {
      extendFields.push(`phone: text()`)
    }
    if (userFields.includes('Location')) {
      extendFields.push(`location: text()`)
    }
    if (userFields.includes('Website')) {
      extendFields.push(`website: text()`)
    }

    const fieldImports = ['text']
    if (hasRoles) fieldImports.push('select')

    const socialProvidersBlock = hasOAuth
      ? `
      socialProviders: {
        ${hasGoogle ? `google: {\n          clientId: process.env.GOOGLE_CLIENT_ID!,\n          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,\n        },` : ''}
        ${hasGithub ? `github: {\n          clientId: process.env.GITHUB_CLIENT_ID!,\n          clientSecret: process.env.GITHUB_CLIENT_SECRET!,\n        },` : ''}
      },`
      : ''

    const configUpdates = `import { config, list } from '@opensaas/stack-core'
import type { AccessControl } from '@opensaas/stack-core'
import { ${fieldImports.join(', ')} } from '@opensaas/stack-core/fields'
import { authPlugin } from '@opensaas/stack-auth'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

// Access control helpers (see lib/access-control.ts for the full set)
const isSignedIn: AccessControl = ({ session }) => !!session

export default config({
  plugins: [
    authPlugin({
      emailAndPassword: { enabled: ${hasPassword} },${socialProvidersBlock}
      ${emailVerification ? `emailVerification: { enabled: true },` : ''}
      sessionFields: ['userId', 'email', 'name'${hasRoles ? ", 'role'" : ''}],
      ${
        extendFields.length > 0
          ? `// Custom fields on the auto-generated User list
      extendUserList: {
        fields: {
          ${extendFields.join(',\n          ')},
        },
      },`
          : ''
      }
      // The auth lists ship closed (deny-by-default) — grant the access your
      // app needs here (ADR-0013).
      access: {
        user: {
          operation: {
            query: isSignedIn,
            update: ({ session, item }) => session?.userId === item?.id,
            delete: ({ session, item }) => ${hasRoles ? `session?.role === 'admin' || session?.userId === item?.id` : `session?.userId === item?.id`},
          },
        },
      },
    }),
  ],
  ${SQLITE_DB_BLOCK},
  // For PostgreSQL use @prisma/adapter-pg instead:
  // ${POSTGRES_DB_BLOCK.replace(/\n/g, '\n  // ')}
  lists: {
    // Your app lists go here. User, Session, Account, and Verification are
    // added automatically by authPlugin.
  },
  ui: {
    basePath: '/admin',
  },
})`

    const files: GeneratedFile[] = []

    // Better-auth server instance
    files.push({
      path: 'lib/auth.ts',
      language: 'typescript',
      description: 'Better-auth server instance and session helper',
      content: `import { createAuth } from '@opensaas/stack-auth/server'
import { headers } from 'next/headers'
import config from '../opensaas.config'
import { rawOpensaasContext } from '@/.opensaas/context'

export const auth = createAuth(config, rawOpensaasContext)

/**
 * Get the current session in OpenSaas format (the configured sessionFields).
 */
export async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session || !session.user) return null
  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,${hasRoles ? `\n    role: (session.user as { role?: string }).role,` : ''}
  }
}

export const GET = auth.handler
export const POST = auth.handler`,
    })

    // Auth API route
    files.push({
      path: 'app/api/auth/[...all]/route.ts',
      language: 'typescript',
      description: 'Better-auth API route (handles all /api/auth/* endpoints)',
      content: `export { GET, POST } from '@/lib/auth'`,
    })

    // Auth server actions. The forms submit through these app-owned
    // 'use server' actions (calling auth.api.* directly) instead of the
    // browser calling /api/auth/*. createAuth auto-adds better-auth's
    // nextCookies plugin, so the session cookie set inside these actions
    // persists. See ADR-0020 and the "Auth action" contract.
    const authActionTypeImports = ['AuthActionResult', 'SignInInput']
    if (hasPassword) {
      authActionTypeImports.push('SignUpInput', 'RequestPasswordResetInput', 'ResetPasswordInput')
    }

    const socialActionSnippet = hasOAuth
      ? `

// OAuth navigates away from the app, so this action performs a server-side
// redirect to the provider (rather than returning a result to the form).
export async function signInSocialAction(provider: string): Promise<void> {
  const response = await auth.api.signInSocial({
    body: { provider, callbackURL: '/admin' },
    headers: await headers(),
  })
  if (response && 'url' in response && response.url) {
    redirect(response.url)
  }
}`
      : ''

    const passwordActionSnippets = hasPassword
      ? `

export async function signUpAction(input: SignUpInput): Promise<AuthActionResult> {
  try {
    await auth.api.signUpEmail({
      body: { name: input.name, email: input.email, password: input.password },
      headers: await headers(),
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: errorMessage(err, 'Sign up failed') }
  }
}

export async function requestPasswordResetAction(
  input: RequestPasswordResetInput,
): Promise<AuthActionResult> {
  try {
    await auth.api.requestPasswordReset({
      body: { email: input.email, redirectTo: '/reset-password' },
      headers: await headers(),
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: errorMessage(err, 'Failed to send reset email') }
  }
}

export async function resetPasswordAction(input: ResetPasswordInput): Promise<AuthActionResult> {
  try {
    await auth.api.resetPassword({
      body: { newPassword: input.password, token: input.token },
      headers: await headers(),
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: errorMessage(err, 'Failed to reset password') }
  }
}`
      : ''

    files.push({
      path: 'lib/actions/auth.ts',
      language: 'typescript',
      description: 'App-owned server actions the auth forms submit through',
      content: `'use server'

import { headers } from 'next/headers'
${hasOAuth ? "import { redirect } from 'next/navigation'\n" : ''}import { auth } from '@/lib/auth'
import type {
  ${authActionTypeImports.join(',\n  ')},
} from '@opensaas/stack-auth/ui'

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

export async function signInAction(input: SignInInput): Promise<AuthActionResult> {
  try {
    await auth.api.signInEmail({
      body: { email: input.email, password: input.password },
      headers: await headers(),
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: errorMessage(err, 'Sign in failed') }
  }
}${passwordActionSnippets}${socialActionSnippet}
`,
    })

    // Sign-in page
    files.push({
      path: 'app/sign-in/page.tsx',
      language: 'tsx',
      description: 'Sign-in page using the pre-built SignInForm',
      content: `import { SignInForm } from '@opensaas/stack-auth/ui'
import { signInAction${hasOAuth ? ', signInSocialAction' : ''} } from '@/lib/actions/auth'
import Link from 'next/link'

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6">Sign In</h1>
        <SignInForm
          signInAction={signInAction}
          ${hasOAuth ? 'signInSocialAction={signInSocialAction}\n          ' : ''}redirectTo="/admin"
          showSocialProviders={${hasOAuth}}
        />
        ${
          hasPassword
            ? `<div className="mt-4 text-center text-sm space-y-2">
          <div>
            <Link href="/forgot-password" className="underline">Forgot your password?</Link>
          </div>
          <div>
            Don&apos;t have an account?{' '}
            <Link href="/sign-up" className="underline">Sign up</Link>
          </div>
        </div>`
            : ''
        }
      </div>
    </div>
  )
}`,
    })

    // Sign-up page
    if (hasPassword) {
      files.push({
        path: 'app/sign-up/page.tsx',
        language: 'tsx',
        description: 'Sign-up page using the pre-built SignUpForm',
        content: `import { SignUpForm } from '@opensaas/stack-auth/ui'
import { signUpAction${hasOAuth ? ', signInSocialAction' : ''} } from '@/lib/actions/auth'

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6">Create Account</h1>
        <SignUpForm
          signUpAction={signUpAction}
          ${hasOAuth ? 'signInSocialAction={signInSocialAction}\n          ' : ''}redirectTo="/admin"
          showSocialProviders={${hasOAuth}}
        />
      </div>
    </div>
  )
}`,
      })

      // Forgot-password page
      files.push({
        path: 'app/forgot-password/page.tsx',
        language: 'tsx',
        description: 'Forgot-password page using the pre-built ForgotPasswordForm',
        content: `import { ForgotPasswordForm } from '@opensaas/stack-auth/ui'
import { requestPasswordResetAction } from '@/lib/actions/auth'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6">Forgot Password</h1>
        <ForgotPasswordForm requestPasswordResetAction={requestPasswordResetAction} />
        <div className="mt-4 text-center text-sm">
          <Link href="/sign-in" className="underline">Back to sign in</Link>
        </div>
      </div>
    </div>
  )
}`,
      })

      // Reset-password page (target of the reset email link)
      files.push({
        path: 'app/reset-password/page.tsx',
        language: 'tsx',
        description: 'Reset-password page using the pre-built ResetPasswordForm',
        content: `import { ResetPasswordForm } from '@opensaas/stack-auth/ui'
import { resetPasswordAction } from '@/lib/actions/auth'

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6">Reset Password</h1>
        <ResetPasswordForm resetPasswordAction={resetPasswordAction} token={token ?? ''} />
      </div>
    </div>
  )
}`,
      })
    }

    // Access control helpers
    files.push({
      path: 'lib/access-control.ts',
      language: 'typescript',
      description: 'Reusable access control functions',
      content: `import type { AccessControl } from '@opensaas/stack-core'

export const isSignedIn: AccessControl = ({ session }) => !!session
${
  hasRoles
    ? `
export const isAdmin: AccessControl = ({ session }) => session?.role === 'admin'

export const isSelf: AccessControl = ({ session, item }) => session?.userId === item?.id

export const isAdminOrSelf: AccessControl = ({ session, item }) =>
  session?.role === 'admin' || session?.userId === item?.id
`
    : `
export const isSelf: AccessControl = ({ session, item }) => session?.userId === item?.id
`
}
// Filter-based access: scope queries to rows the user owns.
// Returning a Prisma filter (instead of a boolean) narrows results silently.
export const ownRecordsOnly: AccessControl = ({ session }) =>
  session ? { userId: { equals: session.userId } } : false`,
    })

    // Environment variables
    const envVars: Record<string, string> = {
      DATABASE_URL: 'file:./dev.db',
      BETTER_AUTH_SECRET: '<generate-with-openssl-rand-base64-32>',
      BETTER_AUTH_URL: 'http://localhost:3000',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    }

    if (hasGoogle) {
      envVars.GOOGLE_CLIENT_ID = '<your-google-client-id>'
      envVars.GOOGLE_CLIENT_SECRET = '<your-google-client-secret>'
    }

    if (hasGithub) {
      envVars.GITHUB_CLIENT_ID = '<your-github-client-id>'
      envVars.GITHUB_CLIENT_SECRET = '<your-github-client-secret>'
    }

    // Next steps
    const nextSteps = [
      'Install dependencies: `pnpm add @opensaas/stack-auth @prisma/adapter-better-sqlite3`',
      'Merge the config updates into your `opensaas.config.ts`',
      'Create the files shown above in your project',
      'Add environment variables to your `.env` file',
      hasOAuth ? 'Set up OAuth applications in Google/GitHub developer consoles' : null,
      'Run `pnpm generate` to update the Prisma schema and generated context',
      'Run `pnpm db:push` to update your database',
      'Start your dev server: `pnpm dev`',
      `Visit http://localhost:3000/${hasPassword ? 'sign-up' : 'sign-in'} to test authentication`,
    ].filter(Boolean) as string[]

    // Dev guide section
    const devGuideSection = `## Authentication Feature

This project uses Better-auth (via \`@opensaas/stack-auth\`) with:

${authMethods.map((m) => `- ${m}`).join('\n')}
${hasRoles ? `\n**User Roles**: ${roles?.join(', ')}` : ''}

The User, Session, Account, and Verification lists are auto-generated by
\`authPlugin\`. They ship closed (deny-by-default) — access is granted through
the plugin's \`access\` option in \`opensaas.config.ts\`.

### Access Control Helpers

\`\`\`typescript
import { isSignedIn${hasRoles ? ', isAdmin, isSelf' : ', isSelf'} } from './lib/access-control'

// In your list config:
access: {
  operation: {
    query: () => true,
    create: isSignedIn,
    update: ({ session, item }) => session?.userId === item?.authorId,
    delete: ${hasRoles ? 'isAdmin' : '({ session, item }) => session?.userId === item?.authorId'},
  },
}
\`\`\`

### Protected Routes

Check the session in server components:

\`\`\`typescript
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'

export default async function ProtectedPage() {
  const session = await getSession()
  if (!session) redirect('/sign-in')

  return <div>Signed in as {session.name}</div>
}
\`\`\`

### Getting the Current User

In server actions or API routes:

\`\`\`typescript
import { getSession } from '@/lib/auth'
import { getContext } from '@/.opensaas/context'

const session = await getSession()
const context = await getContext(session)
const currentUser = session
  ? await context.db.user.findUnique({ where: { id: session.userId } })
  : null
\`\`\``

    return {
      configUpdates,
      files,
      instructions: nextSteps,
      devGuideSection,
      envVars,
      nextSteps,
    }
  }

  /**
   * Generate blog feature
   */
  private generateBlog(): FeatureImplementation {
    const contentEditor = this.answers['content-editor'] as string
    const hasStatus = this.answers['post-status'] as boolean
    const taxonomy = (this.answers['taxonomy'] as string[]) || []
    const postFields = (this.answers['post-fields'] as string[]) || []

    const useTiptap = contentEditor === 'Rich text editor (Tiptap)'
    const hasCategories = taxonomy.includes('Categories')
    const hasTags = taxonomy.includes('Tags')

    // Build Post fields
    const fields = [
      'title: text({ validation: { isRequired: true } })',
      "slug: text({ validation: { isRequired: true }, isIndexed: 'unique' })",
    ]

    if (useTiptap) {
      fields.push('content: richText({ validation: { isRequired: true } })')
    } else {
      fields.push(
        "content: text({ ui: { displayMode: 'textarea' }, validation: { isRequired: true } })",
      )
    }

    fields.push("author: relationship({ ref: 'User.posts' })")

    if (hasStatus) {
      fields.push(
        "status: select({ options: [{ label: 'Draft', value: 'draft' }, { label: 'Published', value: 'published' }], defaultValue: 'draft' })",
      )
      fields.push('publishedAt: timestamp()')
    }

    if (hasCategories) {
      fields.push("category: relationship({ ref: 'Category.posts' })")
    }
    if (hasTags) {
      fields.push("tags: relationship({ ref: 'Tag.posts', many: true })")
    }

    if (postFields.includes('Featured image')) {
      fields.push('featuredImage: text() // URL — or an image() field, see the file-upload feature')
    }
    if (postFields.includes('Excerpt/summary')) {
      fields.push("excerpt: text({ ui: { displayMode: 'textarea' } })")
    }
    if (postFields.includes('SEO metadata (title, description)')) {
      fields.push('seoTitle: text()')
      fields.push('seoDescription: text()')
    }
    if (postFields.includes('Reading time estimate')) {
      fields.push('readingTime: integer()')
    }

    const fieldImports = ['text', 'relationship']
    if (hasStatus) fieldImports.push('select', 'timestamp')
    if (postFields.includes('Reading time estimate')) fieldImports.push('integer')

    const configUpdates = `// Add these imports and lists to your existing opensaas.config.ts
import { ${fieldImports.join(', ')} } from '@opensaas/stack-core/fields'
${useTiptap ? "import { richText } from '@opensaas/stack-tiptap/fields'" : ''}

// Inside config({ lists: { ... } }):
    Post: list({
      fields: {
        ${fields.join(',\n        ')},
      },
      access: {
        operation: {
          ${
            hasStatus
              ? `// Anonymous visitors only see published posts (filter-based access)
          query: ({ session }) => (session ? true : { status: { equals: 'published' } }),`
              : 'query: () => true,'
          }
          create: ({ session }) => !!session,
          update: ({ session, item }) => session?.userId === item?.authorId,
          delete: ({ session, item }) =>
            session?.role === 'admin' || session?.userId === item?.authorId,
        },
      },
      hooks: {
        resolveInput: async ({ operation, resolvedData, item, context }) => {
          const data = { ...resolvedData }
          // Auto-connect the author on create
          if (operation === 'create' && !data.author && context.session?.userId) {
            data.author = { connect: { id: context.session.userId } }
          }
          ${
            hasStatus
              ? `// Auto-set publishedAt when publishing
          if (operation === 'create' && data.status === 'published') {
            data.publishedAt = new Date()
          } else if (operation === 'update' && data.status === 'published' && !item?.publishedAt) {
            data.publishedAt = new Date()
          }`
              : ''
          }
          return data
        },
      },
    }),
    ${
      hasCategories
        ? `Category: list({
      fields: {
        name: text({ validation: { isRequired: true } }),
        slug: text({ validation: { isRequired: true }, isIndexed: 'unique' }),
        posts: relationship({ ref: 'Post.category', many: true }),
      },
      access: {
        operation: {
          query: () => true,
          create: ({ session }) => session?.role === 'admin',
          update: ({ session }) => session?.role === 'admin',
          delete: ({ session }) => session?.role === 'admin',
        },
      },
    }),`
        : ''
    }
    ${
      hasTags
        ? `Tag: list({
      fields: {
        name: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.tags', many: true }),
      },
      access: {
        operation: {
          query: () => true,
          create: ({ session }) => !!session,
          update: ({ session }) => session?.role === 'admin',
          delete: ({ session }) => session?.role === 'admin',
        },
      },
    }),`
        : ''
    }

// If you use authPlugin, give the auto-generated User list the other side of
// the author relationship via extendUserList:
//
//   authPlugin({
//     ...,
//     extendUserList: {
//       fields: {
//         posts: relationship({ ref: 'Post.author', many: true }),
//       },
//     },
//   })`

    const files: GeneratedFile[] = []

    // Blog list page
    files.push({
      path: 'app/blog/page.tsx',
      language: 'tsx',
      description: 'Blog listing page',
      content: `import { getContext } from '@/.opensaas/context'
import Link from 'next/link'

export default async function BlogPage() {
  const context = await getContext()

  const posts = await context.db.post.findMany({
    ${hasStatus ? "where: { status: { equals: 'published' } }," : ''}
    orderBy: { ${hasStatus ? 'publishedAt' : 'createdAt'}: 'desc' },
    include: { author: true },
  })

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-4xl font-bold mb-8">Blog</h1>
      <div className="grid gap-6">
        {posts.map((post) => (
          <article key={post.id} className="border rounded-lg p-6">
            <Link href={\`/blog/\${post.slug}\`}>
              <h2 className="text-2xl font-bold hover:underline">{post.title}</h2>
            </Link>
            ${postFields.includes('Excerpt/summary') ? '<p className="mt-2 text-gray-600">{post.excerpt}</p>' : ''}
            <div className="mt-4 text-sm text-gray-500">
              By {post.author?.name ?? 'Unknown'} · ${hasStatus ? '{post.publishedAt?.toLocaleDateString()}' : '{post.createdAt.toLocaleDateString()}'}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}`,
    })

    // Blog post page
    files.push({
      path: 'app/blog/[slug]/page.tsx',
      language: 'tsx',
      description: 'Individual blog post page',
      content: `import { getContext } from '@/.opensaas/context'
import { notFound } from 'next/navigation'

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const context = await getContext()

  const post = await context.db.post.findFirst({
    where: {
      slug: { equals: slug },
      ${hasStatus ? "status: { equals: 'published' }," : ''}
    },
    include: { author: true },
  })

  if (!post) {
    notFound()
  }

  return (
    <article className="container mx-auto py-8 max-w-3xl">
      <h1 className="text-4xl font-bold mb-4">{post.title}</h1>
      <div className="text-gray-600 mb-8">
        By {post.author?.name ?? 'Unknown'} · ${hasStatus ? '{post.publishedAt?.toLocaleDateString()}' : '{post.createdAt.toLocaleDateString()}'}
      </div>
      ${
        useTiptap
          ? `{/* richText stores Tiptap JSON. Render it to HTML with
          generateHTML(post.content, [StarterKit]) from '@tiptap/html' +
          '@tiptap/starter-kit', or build a custom renderer. */}
      <div className="prose max-w-none">{JSON.stringify(post.content)}</div>`
          : '<div className="prose max-w-none whitespace-pre-wrap">{post.content}</div>'
      }
    </article>
  )
}`,
    })

    const nextSteps = [
      'Merge the config updates into your `opensaas.config.ts`',
      'Add the `posts` relationship to the User list (via authPlugin `extendUserList` shown above)',
      useTiptap ? 'Install the Tiptap package: `pnpm add @opensaas/stack-tiptap`' : null,
      useTiptap
        ? 'For public rendering of rich text, add `@tiptap/html` and `@tiptap/starter-kit`'
        : null,
      'Create the blog pages in your `app/` directory',
      'Run `pnpm generate` to update the Prisma schema',
      'Run `pnpm db:push` to update the database',
      'Create your first blog post in the admin UI at /admin',
    ].filter(Boolean) as string[]

    const devGuideSection = `## Blog Feature

This project includes a blog system with:

- ${contentEditor} for writing posts
${hasStatus ? '- Draft/publish workflow (publishedAt is set automatically by a resolveInput hook)' : ''}
${taxonomy.length > 0 ? `- ${taxonomy.join(' and ')} for organization` : ''}

### Access Control

- Anyone can read ${hasStatus ? 'published posts; signed-in users see drafts too (filter-based access)' : 'posts'}
- Only authenticated users can create posts (author is auto-connected from the session)
- Only authors can update their own posts
- Admins and authors can delete posts`

    return {
      configUpdates,
      files,
      instructions: nextSteps,
      devGuideSection,
      envVars: undefined,
      nextSteps,
    }
  }

  /**
   * Generate comments feature
   */
  private generateComments(): FeatureImplementation {
    const targets = (this.answers['comment-targets'] as string[]) || ['Posts']
    const nestedReplies = this.answers['nested-replies'] as boolean
    const moderation = this.answers['moderation'] as string
    const requiresApproval = moderation === 'Require admin approval'

    // Build one relationship per commentable list (Posts → Post, Products → Product)
    const targetLists = targets
      .filter((t) => t !== 'Other')
      .map((t) => (t.endsWith('s') ? t.slice(0, -1) : t))

    const fields = [
      "content: text({ validation: { isRequired: true }, ui: { displayMode: 'textarea' } })",
      "author: relationship({ ref: 'User.comments' })",
      ...targetLists.map(
        (target) => `${target.toLowerCase()}: relationship({ ref: '${target}.comments' })`,
      ),
    ]

    if (nestedReplies) {
      fields.push("parent: relationship({ ref: 'Comment.replies' })")
      fields.push("replies: relationship({ ref: 'Comment.parent', many: true })")
    }

    if (requiresApproval) {
      fields.push(
        "status: select({ options: [{ label: 'Pending', value: 'pending' }, { label: 'Approved', value: 'approved' }], defaultValue: 'pending' })",
      )
    }

    const fieldImports = ['text', 'relationship']
    if (requiresApproval) fieldImports.push('select')

    const configUpdates = `// Add these imports and lists to your existing opensaas.config.ts
import { ${fieldImports.join(', ')} } from '@opensaas/stack-core/fields'

// Inside config({ lists: { ... } }):
    Comment: list({
      fields: {
        ${fields.join(',\n        ')},
      },
      access: {
        operation: {
          ${
            requiresApproval
              ? `// Everyone sees approved comments; authors see their own pending
          // ones; admins see everything (filter-based access).
          query: ({ session }) => {
            if (session?.role === 'admin') return true
            if (session) {
              return {
                OR: [
                  { status: { equals: 'approved' } },
                  { authorId: { equals: session.userId } },
                ],
              }
            }
            return { status: { equals: 'approved' } }
          },`
              : 'query: () => true,'
          }
          create: ({ session }) => !!session,
          update: ({ session, item }) =>
            session?.role === 'admin' || session?.userId === item?.authorId,
          delete: ({ session, item }) =>
            session?.role === 'admin' || session?.userId === item?.authorId,
        },
      },
      hooks: {
        resolveInput: async ({ operation, resolvedData, context }) => {
          const data = { ...resolvedData }
          // Auto-connect the author on create
          if (operation === 'create' && !data.author && context.session?.userId) {
            data.author = { connect: { id: context.session.userId } }
          }
          return data
        },
      },
    }),

// Add the other side of each relationship:
${targetLists
  .map(
    (target) =>
      `// - On the ${target} list: comments: relationship({ ref: 'Comment.${target.toLowerCase()}', many: true })`,
  )
  .join('\n')}
// - On the User list (via authPlugin extendUserList):
//     comments: relationship({ ref: 'Comment.author', many: true })`

    const nextSteps = [
      'Merge the config updates into your `opensaas.config.ts`',
      ...targetLists.map(
        (target) => `Add the \`comments\` relationship field to your ${target} list`,
      ),
      'Add the `comments` relationship to the User list (via authPlugin `extendUserList`)',
      'Run `pnpm generate` to update the Prisma schema',
      'Run `pnpm db:push` to update the database',
      requiresApproval
        ? 'Moderate comments in the admin UI at /admin/comment (flip status to approved)'
        : 'View comments in the admin UI at /admin/comment',
    ]

    const devGuideSection = `## Comments Feature

Threaded comments on: ${targetLists.join(', ')}

- ${nestedReplies ? 'Nested replies via a self-referential parent/replies relationship' : 'Flat comment threads'}
- ${moderation}
- Authors are auto-connected from the session by a resolveInput hook
- Authors can edit/delete their own comments; admins can moderate everything${
      requiresApproval
        ? '\n- Anonymous visitors only see approved comments (filter-based access)'
        : ''
    }`

    return {
      configUpdates,
      files: [],
      instructions: nextSteps,
      devGuideSection,
      nextSteps,
    }
  }

  /**
   * Generate file upload feature
   */
  private generateFileUpload(): FeatureImplementation {
    const provider = this.answers['storage-provider'] as string
    const associations = (this.answers['file-associations'] as string[]) || []
    const fileTypes = (this.answers['file-types'] as string[]) || []

    const imagesOnly = fileTypes.length === 1 && fileTypes.includes('Images (jpg, png, webp)')

    let storageImport: string
    let storageBlock: string
    let extraDependency: string | null = null
    const envVars: Record<string, string> = {}

    if (provider === 'AWS S3' || provider === 'Cloudflare R2') {
      const isR2 = provider === 'Cloudflare R2'
      storageImport = "import { s3Storage } from '@opensaas/stack-storage-s3'"
      extraDependency = '@opensaas/stack-storage-s3'
      storageBlock = `storage: {
    uploads: s3Storage({
      bucket: process.env.S3_BUCKET!,
      region: process.env.S3_REGION${isR2 ? " || 'auto'" : '!'},
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,${
        isR2
          ? `\n      // R2 is S3-compatible — point the endpoint at your account
      endpoint: process.env.S3_ENDPOINT, // https://<account-id>.r2.cloudflarestorage.com`
          : ''
      }
    }),
  },`
      envVars.S3_BUCKET = '<your-bucket>'
      envVars.S3_REGION = isR2 ? 'auto' : 'us-east-1'
      envVars.S3_ACCESS_KEY_ID = '<access-key-id>'
      envVars.S3_SECRET_ACCESS_KEY = '<secret-access-key>'
      if (isR2) envVars.S3_ENDPOINT = 'https://<account-id>.r2.cloudflarestorage.com'
    } else if (provider === 'Vercel Blob') {
      storageImport = "import { vercelBlobStorage } from '@opensaas/stack-storage-vercel'"
      extraDependency = '@opensaas/stack-storage-vercel'
      storageBlock = `storage: {
    uploads: vercelBlobStorage({
      token: process.env.BLOB_READ_WRITE_TOKEN,
    }),
  },`
      envVars.BLOB_READ_WRITE_TOKEN = '<vercel-blob-read-write-token>'
    } else {
      storageImport = "import { localStorage } from '@opensaas/stack-storage'"
      storageBlock = `storage: {
    uploads: localStorage({
      uploadDir: './public/uploads',
      serveUrl: '/uploads',
    }),
  },`
    }

    const imageFieldExample = `image({
          storage: 'uploads',
          transformations: {
            thumbnail: { width: 100, height: 100, fit: 'cover', format: 'webp' },
          },
          validation: {
            maxFileSize: 5 * 1024 * 1024, // 5MB
            acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
          },
        })`

    const fileFieldExample = `file({
          storage: 'uploads',
          validation: {
            maxFileSize: 25 * 1024 * 1024, // 25MB
          },
        })`

    const fieldExamples: string[] = []
    if (associations.includes('User avatars')) {
      fieldExamples.push(`// On the User list (via authPlugin extendUserList):
        avatar: ${imageFieldExample},`)
    }
    if (associations.includes('Post featured images') || associations.includes('Product images')) {
      const listName = associations.includes('Post featured images') ? 'Post' : 'Product'
      fieldExamples.push(`// On the ${listName} list:
        ${associations.includes('Post featured images') ? 'featuredImage' : 'images'}: ${imageFieldExample},`)
    }
    if (associations.includes('General attachments') || !imagesOnly) {
      fieldExamples.push(`// General attachments on any list:
        attachment: ${fileFieldExample},`)
    }

    const configUpdates = `// Add these imports to your opensaas.config.ts
${storageImport}
import { file, image } from '@opensaas/stack-storage/fields'

// Add a top-level storage config alongside db and lists:
export default config({
  ${storageBlock}
  // ...
  lists: {
    // Use file()/image() fields, referencing the storage key by name:
        ${fieldExamples.join('\n        ')}
  },
})`

    const nextSteps = [
      `Install dependencies: \`pnpm add @opensaas/stack-storage${extraDependency ? ` ${extraDependency}` : ''}\``,
      'Merge the storage config and fields into your `opensaas.config.ts`',
      Object.keys(envVars).length > 0 ? 'Add environment variables to your `.env` file' : null,
      'Run `pnpm generate` to update the Prisma schema',
      'Run `pnpm db:push` to update the database',
      'Upload files through the admin UI — the image/file fields render an upload widget automatically',
    ].filter(Boolean) as string[]

    const devGuideSection = `## File Upload Feature

Storage provider: ${provider}

- Files are stored via the \`storage\` config block; fields reference a storage
  key by name (\`storage: 'uploads'\`)
- \`image()\` fields support transformations (resize/format) and validation
- \`file()\` fields handle any file type with size validation
- Access control on the owning list applies to the field like any other field`

    return {
      configUpdates,
      files: [],
      instructions: nextSteps,
      devGuideSection,
      envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
      nextSteps,
    }
  }

  /**
   * Generate semantic search feature
   */
  private generateSemanticSearch(): FeatureImplementation {
    const searchableContent = (this.answers['searchable-content'] as string[]) || ['Posts']
    const embeddingProvider = this.answers['embedding-provider'] as string
    const searchFields = (this.answers['search-fields'] as string[]) || ['Title', 'Content/body']

    const useOllama = embeddingProvider?.startsWith('Ollama')

    const providerBlock = useOllama
      ? `provider: ollamaEmbeddings({
        baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
        model: 'nomic-embed-text',
      }),
      storage: sqliteVssStorage({
        distanceFunction: 'cosine',
      }),`
      : `provider: openaiEmbeddings({
        apiKey: process.env.OPENAI_API_KEY!,
        model: 'text-embedding-3-small',
      }),
      // pgvectorStorage requires the postgresql db provider.
      // On SQLite, use sqliteVssStorage from '@opensaas/stack-rag' instead.
      storage: pgvectorStorage({
        distanceFunction: 'cosine',
      }),`

    const ragImports = useOllama
      ? "import { ragPlugin, ollamaEmbeddings, sqliteVssStorage } from '@opensaas/stack-rag'"
      : "import { ragPlugin, openaiEmbeddings, pgvectorStorage } from '@opensaas/stack-rag'"

    const targetList = searchableContent[0]?.endsWith('s')
      ? searchableContent[0].slice(0, -1)
      : searchableContent[0] || 'Post'

    const envVars: Record<string, string> = useOllama
      ? { OLLAMA_BASE_URL: 'http://localhost:11434' }
      : { OPENAI_API_KEY: '<your-openai-api-key>' }

    const configUpdates = `// Add these imports to your opensaas.config.ts
${ragImports}
import { searchable } from '@opensaas/stack-rag/fields'

// Add the RAG plugin alongside your other plugins:
export default config({
  plugins: [
    ragPlugin({
      ${providerBlock}
    }),
    // ...your other plugins
  ],
  // ...
  lists: {
    ${targetList}: list({
      fields: {
        // Wrap the fields you want indexed with searchable() —
        // embeddings update automatically when the content changes.
        ${searchFields.includes('Title') ? `title: searchable(text({ validation: { isRequired: true } })),` : ''}
        ${
          searchFields.includes('Content/body')
            ? `content: searchable(
          text({ validation: { isRequired: true }, ui: { displayMode: 'textarea' } }),
        ),`
            : ''
        }
        // ...your other fields
      },
    }),
  },
})`

    const nextSteps = [
      'Install the RAG package: `pnpm add @opensaas/stack-rag`',
      useOllama
        ? 'Install and start Ollama, then pull the embedding model: `ollama pull nomic-embed-text`'
        : 'Set OPENAI_API_KEY in your `.env` file (pgvector storage requires PostgreSQL)',
      'Merge the plugin and searchable() fields into your `opensaas.config.ts`',
      'Run `pnpm generate` to update the Prisma schema',
      'Run `pnpm db:push` to update the database',
      `Query with the RAG runtime — see the ${useOllama ? 'rag-ollama-demo' : 'rag-openai-chatbot'} example for a full search API route`,
    ]

    const devGuideSection = `## Semantic Search Feature

AI-powered search over: ${searchableContent.join(', ')}

- Embedding provider: ${embeddingProvider}
- Fields wrapped in \`searchable()\` are embedded automatically on create/update
- Search respects the list's access control — users only find what they can read
- See the ${useOllama ? 'rag-ollama-demo' : 'rag-openai-chatbot'} example in the stack repo for a complete search UI`

    return {
      configUpdates,
      files: [],
      instructions: nextSteps,
      devGuideSection,
      envVars,
      nextSteps,
    }
  }
}
