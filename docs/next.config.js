import withMarkdoc from '@markdoc/next.js'

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['js', 'jsx', 'ts', 'tsx', 'md', 'mdoc'],
  serverExternalPackages: ['shiki'],
  turbopack: {}, // Empty turbopack config to silence warning
}

export default withMarkdoc()(nextConfig)
