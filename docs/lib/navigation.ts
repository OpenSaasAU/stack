export interface NavItem {
  title: string
  href?: string
  items?: NavItem[]
}

export const navigation: NavItem[] = [
  {
    title: 'Getting Started',
    items: [
      {
        title: 'Quick Start',
        href: '/docs/quick-start',
      },
      {
        title: 'Installation',
        href: '/docs/getting-started',
      },
    ],
  },
  {
    title: 'Core Concepts',
    items: [
      {
        title: 'Access Control',
        href: '/docs/core-concepts/access-control',
      },
      {
        title: 'Field Types',
        href: '/docs/core-concepts/field-types',
      },
      {
        title: 'Hooks System',
        href: '/docs/core-concepts/hooks',
      },
      {
        title: 'Generators',
        href: '/docs/core-concepts/generators',
      },
      {
        title: 'Config System',
        href: '/docs/core-concepts/config',
      },
    ],
  },
  {
    title: 'Packages',
    items: [
      {
        title: 'Core',
        href: '/docs/packages/core',
      },
      {
        title: 'Auth',
        href: '/docs/packages/auth',
      },
      {
        title: 'RAG',
        href: '/docs/packages/rag',
      },
      {
        title: 'Storage',
        href: '/docs/packages/storage',
      },
      {
        title: 'UI',
        href: '/docs/packages/ui',
      },
      {
        title: 'Tiptap',
        href: '/docs/packages/tiptap',
      },
    ],
  },
  {
    title: 'Guides',
    items: [
      {
        title: 'Claude Code Plugin',
        href: '/docs/guides/claude-code',
      },
      {
        title: 'Migration Guide',
        href: '/docs/guides/migration',
      },
      {
        title: 'Custom Fields',
        href: '/docs/guides/custom-fields',
      },
      {
        title: 'Storage Setup',
        href: '/docs/guides/storage-setup',
      },
      {
        title: 'Composability',
        href: '/docs/guides/composability',
      },
      {
        title: 'Authentication',
        href: '/docs/guides/authentication',
      },
      {
        title: 'Writing Plugins',
        href: '/docs/guides/plugins',
      },
      {
        title: 'MCP Setup',
        href: '/docs/guides/mcp-setup',
      },
      {
        title: 'RAG Setup',
        href: '/docs/guides/rag-setup',
      },
      {
        title: 'RAG Advanced',
        href: '/docs/guides/rag-advanced',
      },
      {
        title: 'Deployment',
        href: '/docs/guides/deployment',
      },
    ],
  },
  {
    title: 'API Reference',
    items: [
      {
        title: 'Config',
        href: '/docs/api-reference/config',
      },
      {
        title: 'Fields',
        href: '/docs/api-reference/fields',
      },
      {
        title: 'Context',
        href: '/docs/api-reference/context',
      },
    ],
  },
]
