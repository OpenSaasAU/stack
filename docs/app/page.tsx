import Link from 'next/link'
import { ArrowRight, BookOpen, Code2, Zap } from 'lucide-react'

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
      <section className="container mx-auto px-4 py-20 text-center">
        <h1 className="text-5xl font-bold mb-6">
          Build Admin-Heavy Apps
          <br />
          <span className="text-primary">With Built-In Security</span>
        </h1>
        <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
          A Next.js-based stack for building applications with automatic access control,
          config-first development, and AI-agent-friendly architecture.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/docs/quick-start"
            className="flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
          >
            Quick Start <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/docs/getting-started"
            className="flex items-center gap-2 px-6 py-3 border rounded-lg hover:bg-muted transition-colors"
          >
            <BookOpen className="h-4 w-4" /> Documentation
          </Link>
        </div>
      </section>

      {/* Features Grid */}
      <section className="container mx-auto px-4 py-20">
        <div className="grid md:grid-cols-3 gap-8">
          <div className="p-6 border rounded-lg">
            <div className="h-12 w-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
              <Zap className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Automatic Access Control</h3>
            <p className="text-muted-foreground">
              Define access rules in your config. The engine automatically secures all database
              operations with zero boilerplate.
            </p>
          </div>

          <div className="p-6 border rounded-lg">
            <div className="h-12 w-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
              <Code2 className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Config-First Development</h3>
            <p className="text-muted-foreground">
              Define your schema, fields, and access rules in one place. Generate Prisma schemas and
              TypeScript types automatically.
            </p>
          </div>

          <div className="p-6 border rounded-lg">
            <div className="h-12 w-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
              <BookOpen className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">AI-Agent Friendly</h3>
            <p className="text-muted-foreground">
              Designed to be understandable by AI coding assistants with clear patterns and
              comprehensive documentation.
            </p>
          </div>
        </div>
      </section>

      {/* Quick Links */}
      <section className="container mx-auto px-4 py-20 border-t">
        <h2 className="text-3xl font-bold text-center mb-12">Explore the Docs</h2>
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          <Link
            href="/docs/quick-start"
            className="p-6 border rounded-lg hover:border-primary transition-colors"
          >
            <h3 className="text-xl font-semibold mb-2">Quick Start</h3>
            <p className="text-muted-foreground">
              Get up and running in 5 minutes with a working application.
            </p>
          </Link>

          <Link
            href="/docs/core-concepts/access-control"
            className="p-6 border rounded-lg hover:border-primary transition-colors"
          >
            <h3 className="text-xl font-semibold mb-2">Access Control</h3>
            <p className="text-muted-foreground">
              Learn how the automatic access control engine works.
            </p>
          </Link>

          <Link
            href="/docs/guides/custom-fields"
            className="p-6 border rounded-lg hover:border-primary transition-colors"
          >
            <h3 className="text-xl font-semibold mb-2">Custom Fields</h3>
            <p className="text-muted-foreground">
              Create custom field types with validation and UI components.
            </p>
          </Link>

          <Link
            href="/docs/api-reference/config"
            className="p-6 border rounded-lg hover:border-primary transition-colors"
          >
            <h3 className="text-xl font-semibold mb-2">API Reference</h3>
            <p className="text-muted-foreground">
              Complete API documentation for all config options and field types.
            </p>
          </Link>
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
