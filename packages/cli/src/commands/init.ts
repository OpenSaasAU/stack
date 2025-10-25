import * as path from 'path'
import * as fs from 'fs'
import chalk from 'chalk'
import ora from 'ora'
import prompts from 'prompts'

export async function initCommand(projectName: string | undefined) {
  console.log(chalk.bold.cyan('\n🚀 Create OpenSaaS Project\n'))

  // Prompt for project name if not provided
  if (!projectName) {
    const response = await prompts({
      type: 'text',
      name: 'name',
      message: 'Project name:',
      initial: 'my-opensaas-app',
      validate: (value) => {
        if (!value) return 'Project name is required'
        if (!/^[a-z0-9-]+$/.test(value)) {
          return 'Project name must contain only lowercase letters, numbers, and hyphens'
        }
        return true
      },
    })

    if (!response.name) {
      console.log(chalk.yellow('\n❌ Cancelled'))
      process.exit(0)
    }

    projectName = response.name
  }

  // Type guard to ensure projectName is defined
  if (!projectName) {
    console.error(chalk.red('\n❌ Project name is required'))
    process.exit(1)
  }

  const projectPath = path.join(process.cwd(), projectName)

  // Check if directory already exists
  if (fs.existsSync(projectPath)) {
    console.error(chalk.red(`\n❌ Directory "${projectName}" already exists`))
    process.exit(1)
  }

  const spinner = ora('Creating project structure...').start()

  try {
    // Create project directory
    fs.mkdirSync(projectPath, { recursive: true })

    // Create basic structure
    fs.mkdirSync(path.join(projectPath, 'app'), { recursive: true })
    fs.mkdirSync(path.join(projectPath, 'lib'), { recursive: true })
    fs.mkdirSync(path.join(projectPath, 'prisma'), { recursive: true })

    spinner.text = 'Writing configuration files...'

    // Create package.json
    const packageJson = {
      name: projectName,
      version: '0.1.0',
      private: true,
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
        generate: 'opensaas generate',
        'db:push': 'prisma db push',
        'db:studio': 'prisma studio',
      },
      dependencies: {
        '@opensaas/stack-core': '^0.1.0',
        '@prisma/client': '^5.7.1',
        next: '^14.0.4',
        react: '^18.2.0',
        'react-dom': '^18.2.0',
      },
      devDependencies: {
        '@opensaas/stack-cli': '^0.1.0',
        '@types/node': '^20.10.0',
        '@types/react': '^18.2.45',
        '@types/react-dom': '^18.2.18',
        prisma: '^5.7.1',
        tsx: '^4.7.0',
        typescript: '^5.3.3',
      },
    }

    fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify(packageJson, null, 2))

    // Create tsconfig.json
    const tsConfig = {
      compilerOptions: {
        target: 'ES2022',
        lib: ['dom', 'dom.iterable', 'esnext'],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: 'preserve',
        incremental: true,
        plugins: [{ name: 'next' }],
        paths: {
          '@/*': ['./*'],
        },
      },
      include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
      exclude: ['node_modules'],
    }

    fs.writeFileSync(path.join(projectPath, 'tsconfig.json'), JSON.stringify(tsConfig, null, 2))

    // Create next.config.js
    const nextConfig = `/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', '@opensaas/stack-core'],
  },
}

module.exports = nextConfig
`
    fs.writeFileSync(path.join(projectPath, 'next.config.js'), nextConfig)

    // Create .env
    const env = `DATABASE_URL="file:./dev.db"
`
    fs.writeFileSync(path.join(projectPath, '.env'), env)

    // Create .gitignore
    const gitignore = `# Dependencies
node_modules
.pnp
.pnp.js

# Testing
coverage

# Next.js
.next
out

# Production
build
dist

# Misc
.DS_Store
*.pem

# Debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Local env files
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Vercel
.vercel

# TypeScript
*.tsbuildinfo

# OpenSaaS generated
.opensaas

# Prisma
prisma/dev.db
prisma/dev.db-journal
`
    fs.writeFileSync(path.join(projectPath, '.gitignore'), gitignore)

    // Create opensaas.config.ts
    const config = `import { config, list } from '@opensaas/stack-core'
import { text, relationship, password } from '@opensaas/stack-core/fields'
import type { AccessControl } from '@opensaas/stack-core'

// Access control helpers
const isSignedIn: AccessControl = ({ session }) => {
  return !!session
}

export default config({
  db: {
    provider: 'sqlite',
    url: process.env.DATABASE_URL || 'file:./dev.db',
  },

  lists: {
    User: list({
      fields: {
        name: text({ validation: { isRequired: true } }),
        email: text({
          validation: { isRequired: true },
          isIndexed: 'unique',
        }),
        password: password({ validation: { isRequired: true } }),
      },
    }),
  },

  session: {
    getSession: async () => {
      // TODO: Integrate with your auth system
      return null
    }
  },

  ui: {
    basePath: '/admin',
  }
})
`
    fs.writeFileSync(path.join(projectPath, 'opensaas.config.ts'), config)

    // Create lib/context.ts
    const contextFile = `import { PrismaClient } from '@prisma/client'
import { getContext as createContext } from '@opensaas/stack-core'
import config from '../opensaas.config'
import type { Context } from '../.opensaas/types'

// Singleton Prisma client
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

/**
 * Get an access-controlled context for the current session
 */
export async function getContext(): Promise<Context> {
  const session = config.session ? await config.session.getSession() : null
  const context = await createContext<PrismaClient>(config, prisma, session)
  return context as Context
}
`
    fs.writeFileSync(path.join(projectPath, 'lib', 'context.ts'), contextFile)

    // Create app/page.tsx
    const page = `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-4">Welcome to OpenSaaS</h1>
      <p className="text-gray-600">Your project is ready to go!</p>

      <div className="mt-8 space-y-2">
        <p className="text-sm">Next steps:</p>
        <ol className="text-sm text-gray-600 list-decimal list-inside space-y-1">
          <li>Run <code className="bg-gray-100 px-2 py-1 rounded">npm run generate</code></li>
          <li>Run <code className="bg-gray-100 px-2 py-1 rounded">npm run db:push</code></li>
          <li>Edit <code className="bg-gray-100 px-2 py-1 rounded">opensaas.config.ts</code> to define your schema</li>
        </ol>
      </div>
    </main>
  )
}
`
    fs.writeFileSync(path.join(projectPath, 'app', 'page.tsx'), page)

    // Create app/layout.tsx
    const layout = `export const metadata = {
  title: '${projectName}',
  description: 'Built with OpenSaaS',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`
    fs.writeFileSync(path.join(projectPath, 'app', 'layout.tsx'), layout)

    // Create README.md
    const readme = `# ${projectName}

Built with [OpenSaaS Stack](https://github.com/your-org/opensaas-stack)

## Getting Started

1. Install dependencies:
   \`\`\`bash
   npm install
   # or
   pnpm install
   \`\`\`

2. Generate Prisma schema and types:
   \`\`\`bash
   npm run generate
   \`\`\`

3. Push schema to database:
   \`\`\`bash
   npm run db:push
   \`\`\`

4. Run the development server:
   \`\`\`bash
   npm run dev
   \`\`\`

Open [http://localhost:3000](http://localhost:3000) to see your app.

## Project Structure

- \`opensaas.config.ts\` - Your schema definition with access control
- \`lib/context.ts\` - Database context with access control
- \`app/\` - Next.js app router pages
- \`prisma/\` - Generated Prisma schema
- \`.opensaas/\` - Generated TypeScript types

## Learn More

- [OpenSaaS Documentation](https://github.com/your-org/opensaas-stack)
- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
`
    fs.writeFileSync(path.join(projectPath, 'README.md'), readme)

    spinner.succeed(chalk.green('Project created successfully!'))

    console.log(chalk.bold.green(`\n✨ Created ${projectName}\n`))
    console.log(chalk.gray('Next steps:\n'))
    console.log(chalk.cyan(`  cd ${projectName}`))
    console.log(chalk.cyan('  npm install'))
    console.log(chalk.cyan('  npm run generate'))
    console.log(chalk.cyan('  npm run db:push'))
    console.log(chalk.cyan('  npm run dev'))
    console.log()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    spinner.fail(chalk.red('Failed to create project'))
    console.error(chalk.red('\n❌ Error:'), error.message)

    // Cleanup on failure
    if (fs.existsSync(projectPath)) {
      fs.rmSync(projectPath, { recursive: true, force: true })
    }

    process.exit(1)
  }
}
