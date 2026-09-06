export interface NavItem {
  title: string
  href?: string
  items?: NavItem[]
}

export const navigation: NavItem[] = [
  {
    title: 'Overview',
    href: '/docs',
  },
  {
    title: 'Tutorials',
    items: [
      {
        title: 'Quick Start',
        href: '/docs/tutorials/quick-start',
      },
      {
        title: 'Build with Claude Code',
        href: '/docs/tutorials/build-with-claude-code',
      },
    ],
  },
  {
    title: 'How-to Guides',
    items: [
      {
        title: 'Set up',
        items: [
          {
            title: 'Installation',
            href: '/docs/how-to/installation',
          },
          {
            title: 'Claude Code Workflow',
            href: '/docs/how-to/claude-code',
          },
        ],
      },
      {
        title: 'Build',
        items: [
          {
            title: 'Custom Fields',
            href: '/docs/how-to/custom-fields',
          },
          {
            title: 'Composability',
            href: '/docs/how-to/composability',
          },
          {
            title: 'Bulk Actions',
            href: '/docs/how-to/bulk-actions',
          },
          {
            title: 'Theming',
            href: '/docs/how-to/theming',
          },
          {
            title: 'Theme Presets',
            href: '/docs/how-to/theme-presets',
          },
          {
            title: 'Write a Plugin',
            href: '/docs/how-to/write-a-plugin',
          },
          {
            title: 'Anonymous & Pre-Account Access',
            href: '/docs/how-to/anonymous-access-control',
          },
        ],
      },
      {
        title: 'Integrate',
        items: [
          {
            title: 'Authentication',
            href: '/docs/how-to/authentication',
          },
          {
            title: 'File & Image Storage',
            href: '/docs/how-to/storage',
          },
          {
            title: 'MCP Server',
            href: '/docs/how-to/mcp',
          },
          {
            title: 'RAG',
            href: '/docs/how-to/rag',
          },
          {
            title: 'RAG Advanced',
            href: '/docs/how-to/rag-advanced',
          },
        ],
      },
      {
        title: 'Migrate',
        items: [
          {
            title: 'From Keystone',
            href: '/docs/how-to/migrate-from-keystone',
          },
          {
            title: 'From Other Sources',
            href: '/docs/how-to/migrate',
          },
        ],
      },
      {
        title: 'Deploy',
        items: [
          {
            title: 'Deploy to Production',
            href: '/docs/how-to/deploy',
          },
        ],
      },
    ],
  },
  {
    title: 'Concepts',
    items: [
      {
        title: 'Access Control',
        href: '/docs/concepts/access-control',
      },
      {
        title: 'Config System',
        href: '/docs/concepts/config',
      },
      {
        title: 'Field Types',
        href: '/docs/concepts/field-types',
      },
      {
        title: 'Queries & projections',
        href: '/docs/concepts/queries',
      },
      {
        title: 'Hooks System',
        href: '/docs/concepts/hooks',
      },
      {
        title: 'Generators',
        href: '/docs/concepts/generators',
      },
    ],
  },
  {
    title: 'Reference',
    items: [
      {
        title: 'Config API',
        href: '/docs/reference/config-api',
      },
      {
        title: 'Fields API',
        href: '/docs/reference/fields-api',
      },
      {
        title: 'Context API',
        href: '/docs/reference/context-api',
      },
      {
        title: 'Packages',
        items: [
          {
            title: 'stack-core',
            href: '/docs/reference/core',
          },
          {
            title: 'stack-auth',
            href: '/docs/reference/auth',
          },
          {
            title: 'stack-rag',
            href: '/docs/reference/rag',
          },
          {
            title: 'stack-storage',
            href: '/docs/reference/storage',
          },
          {
            title: 'stack-ui',
            href: '/docs/reference/ui',
          },
          {
            title: 'stack-tiptap',
            href: '/docs/reference/tiptap',
          },
        ],
      },
    ],
  },
]
