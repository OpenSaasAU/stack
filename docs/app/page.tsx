import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowRight,
  BookOpen,
  Bot,
  Braces,
  Github,
  LayoutDashboard,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wand2,
} from 'lucide-react'
import { CodeBlockServer } from '@/components/CodeBlockServer'
import { SessionSwitcher } from '@/components/landing/SessionSwitcher'

const INSTALL_COMMAND = 'npm create opensaas-app@latest my-app'
const GITHUB_URL = 'https://github.com/OpenSaasAU/stack'

const CONFIG_SNIPPET = `import { config, list } from '@opensaas/stack-core'
import { text, select, relationship } from '@opensaas/stack-core/fields'

export default config({
  db: { provider: 'sqlite', url: 'file:./dev.db' },
  lists: {
    Post: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        status: select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
          defaultValue: 'draft',
        }),
        author: relationship({ ref: 'User.posts' }),
      },
      access: {
        operation: {
          // Signed-in users see published posts plus their own drafts;
          // anonymous visitors see published posts only.
          query: ({ session }) =>
            session
              ? {
                  OR: [
                    { status: { equals: 'published' } },
                    { authorId: { equals: session.userId } },
                  ],
                }
              : { status: { equals: 'published' } },
          // Only the author can change a post — a row filter, so
          // everyone else simply matches nothing.
          update: ({ session }) =>
            session ? { authorId: { equals: session.userId } } : false,
        },
      },
    }),
  },
})
`

const PAIN_POINTS = [
  {
    title: 'More code than you can read',
    body: 'An agent turns one prompt into hundreds of lines across routes, actions, and queries. Reviewing every data path for leaks stops scaling on day one.',
  },
  {
    title: 'Security as scattered if-statements',
    body: 'When every handler hand-rolls its own checks, one forgotten where clause leaks the lot. Agents forget differently than humans do — but they forget too.',
  },
  {
    title: 'The demo works either way',
    body: 'Insecure code looks identical in the happy path. It compiles, the demo passes, and the leak waits quietly for production traffic.',
  },
]

const HOW_IT_WORKS = [
  {
    icon: Braces,
    title: 'Define',
    body: 'Lists, fields, and access rules in one opensaas.config.ts.',
  },
  {
    icon: Wand2,
    title: 'Generate',
    body: 'Prisma schema, TypeScript types, and a secured context — from the config.',
  },
  {
    icon: Bot,
    title: 'Build',
    body: 'Features talk to context.db, never raw Prisma. That includes your agent.',
  },
  {
    icon: LayoutDashboard,
    title: 'Administer',
    body: 'A themeable admin UI at /admin, enforcing the same rules.',
  },
]

const SCREENSHOTS = [
  {
    src: '/images/ui-list-view.png',
    alt: 'Generated admin UI list view with filtering',
    label: 'admin/posts',
  },
  {
    src: '/images/ui-edit-form.png',
    alt: 'Generated admin UI edit form',
    label: 'admin/posts/edit',
  },
  {
    src: '/images/ui-admin-dashboard.png',
    alt: 'Generated admin UI dashboard',
    label: 'admin',
  },
]

function SectionHeading({
  kicker,
  title,
  lede,
}: {
  kicker: string
  title: string
  lede?: string
}) {
  return (
    <div className="max-w-2xl mb-10">
      <p className="text-sm font-mono uppercase tracking-widest text-emerald-400 mb-3">{kicker}</p>
      <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-50 mb-4">{title}</h2>
      {lede ? <p className="text-lg text-zinc-400 leading-relaxed">{lede}</p> : null}
    </div>
  )
}

export default function HomePage() {
  return (
    <div className="landing min-h-screen bg-zinc-950 text-zinc-200">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-tight text-zinc-50">Stack</span>
            <span className="px-1.5 py-0.5 rounded border border-emerald-400/40 text-emerald-300 text-[10px] font-mono uppercase tracking-wider">
              Beta
            </span>
            <span className="hidden sm:inline text-sm text-zinc-500">by OpenSaas</span>
          </div>
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link
              href="/docs"
              className="px-3 py-2 text-sm text-zinc-300 hover:text-zinc-50 transition-colors"
            >
              Docs
            </Link>
            <Link
              href="/docs/tutorials/build-with-claude-code"
              className="hidden sm:block px-3 py-2 text-sm text-zinc-300 hover:text-zinc-50 transition-colors"
            >
              Tutorial
            </Link>
            <a
              href={GITHUB_URL}
              className="p-2 text-zinc-300 hover:text-zinc-50 transition-colors"
              aria-label="Stack on GitHub"
            >
              <Github className="h-5 w-5" />
            </a>
            <Link
              href="/docs/tutorials/quick-start"
              className="ml-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium rounded-lg transition-colors text-sm"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* 1 — Hero */}
      <section className="container mx-auto px-4 pt-20 pb-16 md:pt-28 md:pb-24">
        <div className="max-w-3xl">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-zinc-50 mb-6">
            AI agents build features fast.
            <br />
            <span className="text-emerald-400">Stack makes the secure path the only path.</span>
          </h1>
          <p className="text-lg sm:text-xl text-zinc-400 leading-relaxed mb-10 max-w-2xl">
            Stack is a config-first Next.js framework with an access-control engine wrapped around
            every database operation. Rules live in one config; the engine enforces them everywhere
            — so a feature your agent ships is secure by construction, not by review.
          </p>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-zinc-700 bg-zinc-900 font-mono text-sm sm:text-base">
              <span className="text-emerald-400 select-none">$</span>
              <code className="overflow-x-auto whitespace-nowrap">{INSTALL_COMMAND}</code>
            </div>
            <div className="flex gap-3">
              <Link
                href="/docs/tutorials/build-with-claude-code"
                className="inline-flex items-center gap-2 px-5 py-3 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium rounded-xl transition-colors"
              >
                Start the tutorial <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center gap-2 px-5 py-3 border border-zinc-700 hover:border-zinc-500 rounded-xl transition-colors font-medium"
              >
                <BookOpen className="h-4 w-4" /> Docs
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 2 — The pain */}
      <section className="border-t border-zinc-800/80">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <SectionHeading
            kicker="The problem"
            title="You can't review your way to safety."
            lede="Agents multiply how much code ships. They don't multiply how much you can read. Every generated endpoint is another place for data to leak — and the bottleneck is you."
          />
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl">
            {PAIN_POINTS.map((point) => (
              <div
                key={point.title}
                className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/40"
              >
                <h3 className="text-lg font-semibold text-zinc-100 mb-2">{point.title}</h3>
                <p className="text-zinc-400 leading-relaxed text-sm">{point.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3 — The turn */}
      <section className="border-t border-zinc-800/80">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <SectionHeading
            kicker="The turn"
            title="Move the guardrails into the framework."
            lede="In Stack, application code — yours or your agent's — never touches the database directly. Every operation goes through a secured context. Access rules are declared once, in config, and applied to every query, create, update, and delete. There is no unchecked path to forget."
          />
          <div className="max-w-3xl">
            <div className="rounded-2xl border border-zinc-800 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border-b border-zinc-800">
                <span className="h-3 w-3 rounded-full bg-red-400/60" />
                <span className="h-3 w-3 rounded-full bg-yellow-400/60" />
                <span className="h-3 w-3 rounded-full bg-green-400/60" />
                <span className="ml-2 text-xs font-mono text-zinc-500">opensaas.config.ts</span>
              </div>
              <CodeBlockServer language="typescript" content={CONFIG_SNIPPET} />
            </div>
            <p className="mt-4 text-sm text-zinc-500 flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 mt-0.5 text-emerald-400 shrink-0" />
              Denied operations fail silently — <code className="font-mono">null</code> for one
              record, <code className="font-mono">[]</code> for many — so callers can&apos;t probe
              for rows they aren&apos;t allowed to see.
            </p>
          </div>
        </div>
      </section>

      {/* 4 — Session switcher */}
      <section className="border-t border-zinc-800/80">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <SectionHeading
            kicker="See it hold"
            title="Same query. Different caller."
            lede="This is the config above, doing its job. Switch who's asking and watch the engine scope reads and refuse writes — without a single check in the feature code."
          />
          <div className="max-w-5xl">
            <SessionSwitcher />
          </div>
        </div>
      </section>

      {/* 5 — How it works */}
      <section className="border-t border-zinc-800/80">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <SectionHeading
            kicker="How it works"
            title="One config in. A working, guarded app out."
          />
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl">
            {HOW_IT_WORKS.map((step, index) => {
              const Icon = step.icon
              return (
                <div key={step.title} className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/40">
                  <div className="flex items-center justify-between mb-4">
                    <div className="h-10 w-10 rounded-lg bg-emerald-400/10 flex items-center justify-center">
                      <Icon className="h-5 w-5 text-emerald-400" />
                    </div>
                    <span className="text-3xl font-bold text-zinc-800 select-none">{index + 1}</span>
                  </div>
                  <h3 className="text-lg font-semibold text-zinc-100 mb-1">{step.title}</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">{step.body}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* 6 — Admin UI */}
      <section className="border-t border-zinc-800/80">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <SectionHeading
            kicker="Included"
            title="The admin UI comes free."
            lede="Generated from the same config, themeable down to the token, and bound by the same access rules — fields a session can't read simply aren't there."
          />
          <div className="grid md:grid-cols-2 gap-6 max-w-5xl">
            {SCREENSHOTS.map((shot, index) => (
              <div
                key={shot.src}
                className={`rounded-2xl border border-zinc-800 overflow-hidden bg-zinc-900 ${
                  index === 2 ? 'md:col-span-2' : ''
                }`}
              >
                <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800">
                  <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                  <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                  <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                  <span className="ml-2 text-xs font-mono text-zinc-500">{shot.label}</span>
                </div>
                <Image
                  src={shot.src}
                  alt={shot.alt}
                  width={1280}
                  height={800}
                  className="w-full h-auto"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7 — Claude-first workflow */}
      <section className="border-t border-zinc-800/80">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <SectionHeading
            kicker="Agent-ready"
            title="Built to be built on by agents."
            lede="Works with any coding agent. Deepest with Claude Code."
          />
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl">
            <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/40">
              <Terminal className="h-5 w-5 text-emerald-400 mb-4" />
              <h3 className="text-lg font-semibold text-zinc-100 mb-2">A CLAUDE.md in every app</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Scaffolded projects ship the guidance an agent needs to build inside the guardrails
                — patterns, conventions, and the paths it must use.
              </p>
            </div>
            <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/40">
              <Sparkles className="h-5 w-5 text-emerald-400 mb-4" />
              <h3 className="text-lg font-semibold text-zinc-100 mb-2">MCP tools, rules intact</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Every list can be exposed to AI assistants over MCP — and every tool call passes
                through the same access-control engine as the app itself.
              </p>
            </div>
            <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/40">
              <Bot className="h-5 w-5 text-emerald-400 mb-4" />
              <h3 className="text-lg font-semibold text-zinc-100 mb-2">A Claude Code plugin</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Install the Stack plugin and describe features in plain language — the agent scaffolds
                lists, access rules, and UI within the framework&apos;s conventions.
              </p>
            </div>
          </div>
          <div className="mt-8">
            <Link
              href="/docs/how-to/claude-code"
              className="inline-flex items-center gap-2 text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
            >
              Set up the Claude Code workflow <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* 8 — Keystone strip */}
      <section className="border-t border-zinc-800/80">
        <div className="container mx-auto px-4 py-10">
          <div className="max-w-5xl flex flex-col sm:flex-row sm:items-center gap-4 px-6 py-5 rounded-2xl border border-zinc-800 bg-zinc-900/40">
            <p className="text-zinc-300 flex-1">
              <span className="font-semibold text-zinc-100">Coming from Keystone?</span> Stack
              speaks your schema — Keystone-compatible schema generation means you can adopt an
              existing database without a destructive migration.
            </p>
            <Link
              href="/docs/how-to/migrate-from-keystone"
              className="inline-flex items-center gap-2 text-emerald-400 hover:text-emerald-300 transition-colors font-medium whitespace-nowrap"
            >
              Migration guide <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* 9 — Get started */}
      <section className="border-t border-zinc-800/80">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <div className="max-w-3xl">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-50 mb-4">
              Make your agent&apos;s next feature a safe one.
            </h2>
            <p className="text-lg text-zinc-400 mb-8">
              Scaffold an app, open it in your agent, and describe what you want. The guardrails are
              already in place.
            </p>
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-zinc-700 bg-zinc-900 font-mono text-sm sm:text-base mb-6 max-w-xl">
              <span className="text-emerald-400 select-none">$</span>
              <code className="overflow-x-auto whitespace-nowrap">{INSTALL_COMMAND}</code>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-8">
              <Link
                href="/docs/tutorials/build-with-claude-code"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 rounded-xl transition-colors font-medium"
              >
                Build the tutorial app <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-zinc-700 hover:border-zinc-500 rounded-xl transition-colors font-medium"
              >
                Read the docs
              </Link>
            </div>
            <p className="text-sm text-zinc-500">
              Stack is in beta: the onboarding path and core APIs are stable enough to build on —
              pin versions for production.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-800/80 py-10">
        <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-zinc-500">
          <p>
            <span className="font-semibold text-zinc-300">Stack</span> by OpenSaas ·{' '}
            {new Date().getFullYear()}
          </p>
          <div className="flex items-center gap-6">
            <Link href="/docs" className="hover:text-zinc-300 transition-colors">
              Docs
            </Link>
            <Link
              href="/docs/tutorials/build-with-claude-code"
              className="hover:text-zinc-300 transition-colors"
            >
              Tutorial
            </Link>
            <a href={GITHUB_URL} className="hover:text-zinc-300 transition-colors">
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
