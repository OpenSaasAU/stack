# OpenSaaS Stack Documentation Site

This is the official documentation site for OpenSaaS Stack, built with Next.js 16 and Markdoc.

## Features

- **Markdoc Rendering**: All documentation pages are written in Markdown with Markdoc
- **Copy Markdown Button**: Every page has a button to copy the raw markdown for AI assistants
- **Syntax Highlighting**: Code blocks are highlighted with Shiki
- **Responsive Design**: Works on mobile, tablet, and desktop
- **Dark Mode**: Automatic dark mode using Tailwind CSS and `prefers-color-scheme`

## Development

### Install Dependencies

From the repo root:

```bash
pnpm install
```

### Run Development Server

```bash
cd docs
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to view the site.

### Build for Production

```bash
pnpm build
pnpm start
```

## Content Structure

All documentation pages are stored in the `content/` directory as Markdown files:

```
content/
├── quick-start.md
├── getting-started.md
├── core-concepts/
│   ├── access-control.md
│   ├── field-types.md
│   ├── hooks.md
│   └── config.md
├── packages/
│   ├── core.md
│   ├── auth.md
│   └── ui.md
└── guides/
    ├── custom-fields.md
    └── deployment.md
```

## Adding New Pages

1. Create a new `.md` file in the `content/` directory
2. Add the page to `lib/navigation.ts`
3. The page will automatically be available at `/docs/[...slug]`

## Markdoc Components

Custom Markdoc components are available:

### Callout

```markdown
{% callout type="info" %}
This is an informational callout.
{% /callout %}
```

Types: `info`, `warning`, `error`, `success`

### Code Blocks

Code blocks automatically include syntax highlighting and a copy button:

````markdown
```typescript
const example = "Hello, World!"
```
````

## Deployment

The site is ready to deploy to Vercel or any other Next.js hosting platform:

```bash
pnpm build
```

## Screenshots

Screenshots are generated from the blog example using Playwright MCP and stored in `public/screenshots/`.

To regenerate screenshots:

```bash
# Start the blog demo
cd examples/blog
pnpm dev

# In another terminal, generate screenshots
cd docs
pnpm generate-screenshots
```
