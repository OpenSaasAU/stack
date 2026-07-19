import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowRight, BookOpen, Compass, GraduationCap, Library, Wrench } from 'lucide-react'
import { DocLayout } from '@/components/DocLayout'

export const metadata: Metadata = {
  title: 'Documentation',
  description:
    'Stack documentation — tutorials, how-to guides, concepts, and reference for the config-first Next.js framework with access control on every database operation.',
}

const QUADRANTS = [
  {
    icon: GraduationCap,
    title: 'Tutorials',
    purpose: 'Learn by building. Start here if Stack is new to you.',
    links: [
      { title: 'Quick Start', href: '/docs/tutorials/quick-start' },
      { title: 'Build with Claude Code', href: '/docs/tutorials/build-with-claude-code' },
    ],
  },
  {
    icon: Wrench,
    title: 'How-to Guides',
    purpose: 'Get a specific job done — auth, storage, theming, migration, deployment.',
    links: [
      { title: 'Add Authentication', href: '/docs/how-to/authentication' },
      { title: 'Migrate from Keystone', href: '/docs/how-to/migrate-from-keystone' },
      { title: 'Deploy to Production', href: '/docs/how-to/deploy' },
    ],
  },
  {
    icon: Compass,
    title: 'Concepts',
    purpose: 'Understand how Stack thinks — the access-control engine above all.',
    links: [
      { title: 'Access Control', href: '/docs/concepts/access-control' },
      { title: 'Config System', href: '/docs/concepts/config' },
      { title: 'Hooks System', href: '/docs/concepts/hooks' },
    ],
  },
  {
    icon: Library,
    title: 'Reference',
    purpose: 'Look up APIs and packages precisely, once you know what you need.',
    links: [
      { title: 'Config API', href: '/docs/reference/config-api' },
      { title: 'Fields API', href: '/docs/reference/fields-api' },
      { title: 'Context API', href: '/docs/reference/context-api' },
    ],
  },
]

const START_HERE = [
  {
    step: '1',
    title: 'Quick Start',
    body: 'Scaffold an app and see the generated admin UI in about ten minutes.',
    href: '/docs/tutorials/quick-start',
  },
  {
    step: '2',
    title: 'Build with Claude Code',
    body: 'Build a real app by describing features to an agent — with the guardrails doing their job.',
    href: '/docs/tutorials/build-with-claude-code',
  },
  {
    step: '3',
    title: 'Access Control',
    body: 'Understand the engine that makes the secure path the only path.',
    href: '/docs/concepts/access-control',
  },
]

export default function DocsLandingPage() {
  return (
    <DocLayout>
      <div className="max-w-3xl">
        <h1 className="text-4xl font-bold mb-4">Stack documentation</h1>
        <p className="text-lg text-muted-foreground leading-relaxed mb-10">
          Stack is a config-first Next.js framework where access control is enforced on every
          database operation — so features built by you <em>or your AI agent</em> are secure by
          construction. Define lists, fields, and access rules once; Stack generates the Prisma
          schema, TypeScript types, a secured context, and an admin UI.
        </p>

        <h2 className="text-2xl font-bold mb-4">Start here</h2>
        <ol className="space-y-3 mb-12 list-none p-0">
          {START_HERE.map((item) => (
            <li key={item.step}>
              <Link
                href={item.href}
                className="flex items-start gap-4 p-4 rounded-xl border hover:border-primary/60 transition-colors group"
              >
                <span className="h-8 w-8 shrink-0 rounded-full bg-primary/10 text-primary font-mono font-bold flex items-center justify-center">
                  {item.step}
                </span>
                <span>
                  <span className="font-semibold group-hover:text-primary transition-colors flex items-center gap-2">
                    {item.title} <ArrowRight className="h-4 w-4" />
                  </span>
                  <span className="text-sm text-muted-foreground">{item.body}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>

        <h2 className="text-2xl font-bold mb-4">Find your way</h2>
        <div className="grid sm:grid-cols-2 gap-4 mb-12">
          {QUADRANTS.map((quadrant) => {
            const Icon = quadrant.icon
            return (
              <div key={quadrant.title} className="p-5 rounded-xl border">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold text-lg">{quadrant.title}</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-3">{quadrant.purpose}</p>
                <ul className="space-y-1 list-none p-0 m-0">
                  {quadrant.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                      >
                        {link.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>

        <div className="flex items-start gap-3 p-4 rounded-xl border bg-muted/50 text-sm text-muted-foreground">
          <BookOpen className="h-4 w-4 mt-0.5 shrink-0" />
          <p className="m-0">
            Working with an AI assistant? Every page has a <strong>Copy Markdown</strong> button so
            you can hand your agent the exact page it needs — and scaffolded Stack apps ship a{' '}
            <code>CLAUDE.md</code> plus MCP tooling out of the box.
          </p>
        </div>
      </div>
    </DocLayout>
  )
}
