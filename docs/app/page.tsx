import Link from 'next/link'
import { ArrowRight, Code2, MessageSquareCode, Rocket, ShieldCheck, Terminal } from 'lucide-react'
import { CodeBlockServer } from '@/components/CodeBlockServer'

const INSTALL_COMMAND = 'npm create opensaas-app@latest my-app'

const CONFIG_SNIPPET = `import { config, list } from '@opensaas/stack-core'
import { text, select, relationship } from '@opensaas/stack-core/fields'

export default config({
  db: { provider: 'sqlite', url: 'file:./dev.db' },
  lists: {
    Post: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        status: select({
          options: ['draft', 'published'],
          defaultValue: 'draft',
        }),
        author: relationship({ ref: 'User.posts' }),
      },
      access: {
        // Anyone can read; only signed-in authors can edit their own posts.
        operation: {
          query: () => true,
          update: ({ session }) => Boolean(session?.userId),
        },
        filter: {
          update: ({ session }) => ({ authorId: { equals: session?.userId } }),
        },
      },
    }),
  },
})
`

const STEPS = [
  {
    icon: Terminal,
    label: 'Step 1',
    title: 'Scaffold your app',
    code: 'npm create opensaas-app',
    description: 'One command sets up a fully configured OpenSaaS Stack project.',
  },
  {
    icon: Rocket,
    label: 'Step 2',
    title: 'Start the dev server',
    code: 'pnpm dev',
    description: 'Your admin UI, database, and access control are wired up out of the box.',
  },
  {
    icon: MessageSquareCode,
    label: 'Step 3',
    title: 'Describe a feature',
    code: 'Ask Claude Code',
    description: 'Tell Claude Code what you want. It builds it on OpenSaaS Stack for you.',
  },
]

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Code2 className="h-6 w-6" />
            <span className="text-xl font-bold">OpenSaaS Stack</span>
          </div>
          <Link
            href="/docs/quick-start"
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
          >
            Get Started
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 pt-16 pb-12 md:pt-24 md:pb-20">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full border bg-muted text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Access control handled for you
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-6">
            Describe a feature.
            <br />
            <span className="text-primary">Claude Code builds it.</span>
          </h1>

          <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            OpenSaaS Stack is a config-first Next.js stack built for AI-assisted development. Tell
            Claude Code what you want and it ships real features &mdash; with security and
            access&#8209;control baked in.
          </p>

          {/* Prominent install command */}
          <div className="max-w-xl mx-auto mb-8">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2 font-mono">
              Start in seconds
            </p>
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-muted/60 shadow-sm text-left">
              <span className="text-primary font-mono select-none">$</span>
              <code className="flex-1 font-mono text-sm sm:text-base text-foreground overflow-x-auto whitespace-nowrap">
                {INSTALL_COMMAND}
              </code>
            </div>
          </div>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
            <Link
              href="/docs/quick-start"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors font-medium"
            >
              Quick Start <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/docs/guides/claude-code"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 border rounded-lg hover:bg-muted transition-colors font-medium"
            >
              <MessageSquareCode className="h-4 w-4" /> Build with Claude Code
            </Link>
          </div>
        </div>
      </section>

      {/* Config snippet */}
      <section className="container mx-auto px-4 pb-16 md:pb-24">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-6">
            <h2 className="text-2xl sm:text-3xl font-bold mb-2">One config, fully secured</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Define your data and access rules in{' '}
              <code className="font-mono">opensaas.config.ts</code>. The engine secures every
              database operation automatically.
            </p>
          </div>
          <div className="rounded-xl border overflow-hidden shadow-sm">
            <div className="flex items-center gap-2 px-4 py-2 bg-muted border-b">
              <span className="h-3 w-3 rounded-full bg-red-400/70" />
              <span className="h-3 w-3 rounded-full bg-yellow-400/70" />
              <span className="h-3 w-3 rounded-full bg-green-400/70" />
              <span className="ml-2 text-xs font-mono text-muted-foreground">
                opensaas.config.ts
              </span>
            </div>
            <CodeBlockServer language="typescript" content={CONFIG_SNIPPET} />
          </div>
        </div>
      </section>

      {/* Three-step flow */}
      <section className="container mx-auto px-4 py-16 md:py-20 border-t">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-3">From zero to feature in three steps</h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            No boilerplate, no manual wiring. Scaffold, run, and let Claude Code do the building.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {STEPS.map((step, index) => {
            const Icon = step.icon
            return (
              <div key={step.title} className="relative p-6 border rounded-xl bg-muted/30">
                <div className="flex items-center justify-between mb-4">
                  <div className="h-12 w-12 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <span className="text-4xl font-bold text-primary/15 select-none">
                    {index + 1}
                  </span>
                </div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-mono mb-1">
                  {step.label}
                </p>
                <h3 className="text-xl font-semibold mb-2">{step.title}</h3>
                <code className="inline-block px-2 py-1 mb-3 text-sm font-mono rounded bg-muted text-foreground border">
                  {step.code}
                </code>
                <p className="text-muted-foreground text-sm">{step.description}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* Why it matters */}
      <section className="container mx-auto px-4 py-16 md:py-20 border-t">
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <div className="p-6 border rounded-xl">
            <div className="h-12 w-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
              <ShieldCheck className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Security by default</h3>
            <p className="text-muted-foreground">
              Access control wraps every database operation. Denied requests fail silently &mdash;
              no data leaks, no boilerplate.
            </p>
          </div>

          <div className="p-6 border rounded-xl">
            <div className="h-12 w-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
              <Code2 className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Config-first development</h3>
            <p className="text-muted-foreground">
              Define schema, fields, and rules in one place. Prisma schema and TypeScript types are
              generated for you.
            </p>
          </div>

          <div className="p-6 border rounded-xl">
            <div className="h-12 w-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
              <MessageSquareCode className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Built for Claude Code</h3>
            <p className="text-muted-foreground">
              Clear, predictable patterns mean AI assistants can map your requirements to real,
              working features.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container mx-auto px-4 text-center text-muted-foreground">
          <p>OpenSaaS Stack © {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  )
}
