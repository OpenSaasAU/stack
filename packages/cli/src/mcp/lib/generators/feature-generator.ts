/**
 * Feature generator - Generates code, config, and documentation for features
 */

import type { Feature, FeatureImplementation, GeneratedFile } from '../types.js'

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

    const hasOAuth = authMethods.some((m) => ['Google OAuth', 'GitHub OAuth'].includes(m))
    const hasPassword = authMethods.includes('Email & Password')
    const hasMagicLink = authMethods.includes('Magic Links')

    // Build User list fields
    const fields = ['email: text({ validation: { isRequired: true } })']

    if (hasPassword) {
      fields.push('password: password({ validation: { isRequired: true } })')
    }

    fields.push('name: text()')

    if (hasRoles && roles) {
      fields.push(
        `role: select({ options: [${roles.map((r) => `'${r}'`).join(', ')}], defaultValue: '${roles[roles.length - 1]}' })`,
      )
    }

    if (userFields.includes('Avatar')) {
      fields.push('avatar: text()')
    }
    if (userFields.includes('Bio')) {
      fields.push('bio: text({ ui: { displayMode: "textarea" } })')
    }
    if (userFields.includes('Phone')) {
      fields.push('phone: text()')
    }
    if (userFields.includes('Location')) {
      fields.push('location: text()')
    }
    if (userFields.includes('Website')) {
      fields.push('website: text()')
    }

    // Config updates
    const configUpdates = `import { config, list } from '@opensaas/stack-core';
import { text, password, select } from '@opensaas/stack-core/fields';
import { authPlugin } from '@opensaas/stack-auth';

export default config({
  plugins: [
    authPlugin({
      emailAndPassword: { enabled: ${hasPassword} },
      ${
        hasOAuth
          ? `oauth: {
        google: { enabled: ${authMethods.includes('Google OAuth')} },
        github: { enabled: ${authMethods.includes('GitHub OAuth')} },
      },`
          : ''
      }
      ${hasMagicLink ? `magicLink: { enabled: true },` : ''}
      ${emailVerification ? `emailVerification: { enabled: true },` : ''}
      sessionFields: ['userId', 'email', 'name'${hasRoles ? ", 'role'" : ''}],
    }),
  ],
  db: {
    provider: 'postgresql', // or 'sqlite'
    url: process.env.DATABASE_URL,
  },
  lists: {
    User: list({
      fields: {
        ${fields.join(',\n        ')}
      },
      access: {
        operation: {
          query: () => true,
          create: () => true, // Public sign-up
          update: ({ session, item }) => session?.userId === item.id,
          delete: ({ session }) => session?.role === 'admin',
        },
      },
    }),
    // Add your other lists here
  },
});`

    // Generated files
    const files: GeneratedFile[] = []

    // Sign-in page
    if (hasPassword || hasOAuth) {
      files.push({
        path: 'app/sign-in/page.tsx',
        language: 'tsx',
        description: 'Sign-in page with form and OAuth buttons',
        content: `import { SignInForm } from '@opensaas/stack-auth/ui';

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6">Sign In</h1>
        <SignInForm
          ${hasPassword ? 'emailAndPassword' : ''}
          ${hasOAuth ? `oauth={[${authMethods.includes('Google OAuth') ? "'google'" : ''}${authMethods.includes('GitHub OAuth') ? ", 'github'" : ''}]}` : ''}
          redirectTo="/dashboard"
        />
      </div>
    </div>
  );
}`,
      })
    }

    // Sign-up page
    if (hasPassword) {
      files.push({
        path: 'app/sign-up/page.tsx',
        language: 'tsx',
        description: 'Sign-up page with registration form',
        content: `import { SignUpForm } from '@opensaas/stack-auth/ui';

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6">Create Account</h1>
        <SignUpForm
          fields={['email', 'password', 'name']}
          redirectTo="/dashboard"
          ${emailVerification ? 'requireEmailVerification' : ''}
        />
      </div>
    </div>
  );
}`,
      })
    }

    // Access control helpers
    files.push({
      path: 'lib/access-control.ts',
      language: 'typescript',
      description: 'Reusable access control functions',
      content: `import type { AccessControl } from '@opensaas/stack-core';

export const isAuthenticated: AccessControl = ({ session }) => {
  return !!session?.userId;
};

${
  hasRoles
    ? `export const isAdmin: AccessControl = ({ session }) => {
  return session?.role === 'admin';
};

export const isOwner: AccessControl = ({ session, item }) => {
  return session?.userId === item.id;
};

export const isAdminOrOwner: AccessControl = ({ session, item }) => {
  return session?.role === 'admin' || session?.userId === item.id;
};`
    : ''
}

export const requireAuth: AccessControl = ({ session }) => {
  if (!session?.userId) {
    throw new Error('Authentication required');
  }
  return true;
};`,
    })

    // Environment variables
    const envVars: Record<string, string> = {
      DATABASE_URL: 'postgresql://user:password@localhost:5432/mydb',
      BETTER_AUTH_SECRET: '<generate-with-openssl-rand-base64-32>',
      BETTER_AUTH_URL: 'http://localhost:3000',
    }

    if (authMethods.includes('Google OAuth')) {
      envVars.GOOGLE_CLIENT_ID = '<your-google-client-id>'
      envVars.GOOGLE_CLIENT_SECRET = '<your-google-client-secret>'
    }

    if (authMethods.includes('GitHub OAuth')) {
      envVars.GITHUB_CLIENT_ID = '<your-github-client-id>'
      envVars.GITHUB_CLIENT_SECRET = '<your-github-client-secret>'
    }

    // Next steps
    const nextSteps = [
      'Copy the config updates to your `opensaas.config.ts`',
      'Create the files shown above in your project',
      'Add environment variables to your `.env` file',
      hasOAuth ? 'Set up OAuth applications in Google/GitHub developer consoles' : null,
      'Run `pnpm generate` to update Prisma schema',
      'Run `pnpm db:push` to update your database',
      'Start your dev server: `pnpm dev`',
      `Visit http://localhost:3000/${hasPassword ? 'sign-up' : 'sign-in'} to test authentication`,
    ].filter(Boolean) as string[]

    // Dev guide section
    const devGuideSection = `## Authentication Feature

This project uses Better-auth for authentication with the following configuration:

${authMethods.map((m) => `- ${m}`).join('\n')}
${hasRoles ? `\n**User Roles**: ${roles?.join(', ')}` : ''}

### Access Control Helpers

Use these functions in your list configurations:

\`\`\`typescript
import { isAuthenticated${hasRoles ? ', isAdmin, isOwner' : ''} } from './lib/access-control';

// In your list config:
access: {
  operation: {
    query: () => true,
    create: isAuthenticated,
    update: isOwner,
    delete: ${hasRoles ? 'isAdmin' : 'isOwner'},
  }
}
\`\`\`

### Protected Routes

To protect a route, check the session in your server components:

\`\`\`typescript
import { auth } from '@/lib/auth';

export default async function ProtectedPage() {
  const session = await auth();

  if (!session) {
    redirect('/sign-in');
  }

  return <div>Protected content for {session.user.name}</div>;
}
\`\`\`

### Getting the Current User

In server actions or API routes:

\`\`\`typescript
import { getContext } from '@/.opensaas/context';

const context = await getContext();
const currentUser = await context.db.user.findUnique({
  where: { id: context.session?.userId }
});
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
    const _commentsEnabled = this.answers['comments-enabled'] as boolean

    const useTiptap = contentEditor === 'Rich text editor (Tiptap)'
    const useMarkdown = contentEditor === 'Markdown'

    // Build Post fields
    const fields = [
      'title: text({ validation: { isRequired: true } })',
      'slug: text({ validation: { isRequired: true } })',
    ]

    if (useTiptap) {
      fields.push('content: richText({ validation: { isRequired: true } })')
    } else if (useMarkdown) {
      fields.push(
        'content: text({ ui: { displayMode: "textarea" }, validation: { isRequired: true } })',
      )
    } else {
      fields.push(
        'content: text({ ui: { displayMode: "textarea" }, validation: { isRequired: true } })',
      )
    }

    fields.push('author: relationship({ ref: "User.posts" })')

    if (hasStatus) {
      fields.push("status: select({ options: ['draft', 'published'], defaultValue: 'draft' })")
      fields.push('publishedAt: timestamp()')
    }

    if (postFields.includes('Featured image')) {
      fields.push('featuredImage: text()')
    }
    if (postFields.includes('Excerpt/summary')) {
      fields.push('excerpt: text({ ui: { displayMode: "textarea" } })')
    }
    if (postFields.includes('SEO metadata (title, description)')) {
      fields.push('seoTitle: text()')
      fields.push('seoDescription: text()')
    }
    if (postFields.includes('Reading time estimate')) {
      fields.push('readingTime: integer()')
    }

    const configUpdates = `import { config, list } from '@opensaas/stack-core';
import { text, select, relationship, timestamp${useTiptap ? '' : ', integer'} } from '@opensaas/stack-core/fields';
${useTiptap ? "import { richText } from '@opensaas/stack-tiptap/fields';" : ''}

export default config({
  lists: {
    Post: list({
      fields: {
        ${fields.join(',\n        ')},
      },
      access: {
        operation: {
          query: ({ session }) => {
            ${hasStatus ? "if (!session) return { status: { equals: 'published' } };" : ''}
            return true;
          },
          create: ({ session }) => !!session?.userId,
          update: ({ session, item }) => session?.userId === item.authorId,
          delete: ({ session, item }) =>
            session?.role === 'admin' || session?.userId === item.authorId,
        },
      },
      hooks: {
        ${
          hasStatus
            ? `resolveInput: async ({ resolvedData, operation }) => {
          // Auto-set publishedAt when publishing
          if (operation === 'update' && resolvedData.status === 'published' && !resolvedData.publishedAt) {
            resolvedData.publishedAt = new Date();
          }
          return resolvedData;
        },`
            : ''
        }
      },
    }),
    ${
      taxonomy.includes('Categories')
        ? `Category: list({
      fields: {
        name: text({ validation: { isRequired: true } }),
        slug: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.category', many: true }),
      },
    }),`
        : ''
    }
    ${
      taxonomy.includes('Tags')
        ? `Tag: list({
      fields: {
        name: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.tags', many: true }),
      },
    }),`
        : ''
    }
  },
});`

    const files: GeneratedFile[] = []

    // Blog list page
    files.push({
      path: 'app/blog/page.tsx',
      language: 'tsx',
      description: 'Blog listing page',
      content: `import { getContext } from '@/.opensaas/context';
import Link from 'next/link';

export default async function BlogPage() {
  const context = await getContext();

  const posts = await context.db.post.findMany({
    ${hasStatus ? "where: { status: 'published' }," : ''}
    orderBy: { ${hasStatus ? 'publishedAt' : 'createdAt'}: 'desc' },
    include: { author: true },
  });

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-4xl font-bold mb-8">Blog</h1>
      <div className="grid gap-6">
        {posts.map((post) => (
          <article key={post.id} className="border rounded-lg p-6">
            <Link href={\`/blog/\${post.slug}\`}>
              <h2 className="text-2xl font-bold hover:underline">
                {post.title}
              </h2>
            </Link>
            ${postFields.includes('Excerpt/summary') ? '<p className="mt-2 text-gray-600">{post.excerpt}</p>' : ''}
            <div className="mt-4 text-sm text-gray-500">
              By {post.author.name} · ${hasStatus ? '{post.publishedAt?.toLocaleDateString()}' : '{post.createdAt.toLocaleDateString()}'}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}`,
    })

    // Blog post page
    files.push({
      path: 'app/blog/[slug]/page.tsx',
      language: 'tsx',
      description: 'Individual blog post page',
      content: `import { getContext } from '@/.opensaas/context';
import { notFound } from 'next/navigation';

export default async function BlogPostPage({
  params,
}: {
  params: { slug: string };
}) {
  const context = await getContext();

  const post = await context.db.post.findFirst({
    where: {
      slug: params.slug,
      ${hasStatus ? "status: 'published'," : ''}
    },
    include: { author: true },
  });

  if (!post) {
    notFound();
  }

  return (
    <article className="container mx-auto py-8 max-w-3xl">
      <h1 className="text-4xl font-bold mb-4">{post.title}</h1>
      <div className="text-gray-600 mb-8">
        By {post.author.name} · ${hasStatus ? '{post.publishedAt?.toLocaleDateString()}' : '{post.createdAt.toLocaleDateString()}'}
      </div>
      ${useTiptap ? '<div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: post.content }} />' : useMarkdown ? '<div className="prose max-w-none">{/* Render markdown here */}{post.content}</div>' : '<div className="prose max-w-none whitespace-pre-wrap">{post.content}</div>'}
    </article>
  );
}`,
    })

    const nextSteps = [
      'Copy the config updates to your `opensaas.config.ts`',
      'Add the `posts` relationship field to your User list',
      useTiptap ? 'Install Tiptap package: `pnpm add @opensaas/stack-tiptap`' : null,
      'Create the blog pages in your `app/` directory',
      'Run `pnpm generate` to update Prisma schema',
      'Run `pnpm db:push` to update database',
      'Create your first blog post in the admin UI',
    ].filter(Boolean) as string[]

    const devGuideSection = `## Blog Feature

This project includes a blog system with:

- ${contentEditor} for writing posts
${hasStatus ? '- Draft/publish workflow' : ''}
${taxonomy.length > 0 ? `- ${taxonomy.join(' and ')} for organization` : ''}

### Creating a Post

${
  hasStatus
    ? `Posts start as drafts and can be published when ready:

\`\`\`typescript
const post = await context.db.post.create({
  data: {
    title: 'My Post',
    slug: 'my-post',
    content: '...',
    authorId: session.userId,
    status: 'draft', // or 'published'
  }
});
\`\`\``
    : ''
}

### Access Control

- Anyone can read ${hasStatus ? 'published posts' : 'posts'}
- Only authenticated users can create posts
- Only authors can update their own posts
- Admins and authors can delete posts`

    return {
      configUpdates,
      files,
      instructions: nextSteps,
      devGuideSection,
      envVars: useTiptap ? {} : undefined,
      nextSteps,
    }
  }

  /**
   * Generate comments feature (stub - to be implemented)
   */
  private generateComments(): FeatureImplementation {
    return {
      configUpdates: '// Comments feature implementation coming soon',
      files: [],
      instructions: ['Feature implementation in progress'],
      devGuideSection: '## Comments Feature\n\nComing soon...',
      nextSteps: ['Feature implementation in progress'],
    }
  }

  /**
   * Generate file upload feature (stub - to be implemented)
   */
  private generateFileUpload(): FeatureImplementation {
    return {
      configUpdates: '// File upload feature implementation coming soon',
      files: [],
      instructions: ['Feature implementation in progress'],
      devGuideSection: '## File Upload Feature\n\nComing soon...',
      nextSteps: ['Feature implementation in progress'],
    }
  }

  /**
   * Generate semantic search feature (stub - to be implemented)
   */
  private generateSemanticSearch(): FeatureImplementation {
    return {
      configUpdates: '// Semantic search feature implementation coming soon',
      files: [],
      instructions: ['Feature implementation in progress'],
      devGuideSection: '## Semantic Search Feature\n\nComing soon...',
      nextSteps: ['Feature implementation in progress'],
    }
  }
}
