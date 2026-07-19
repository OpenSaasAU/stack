import withMarkdoc from '@markdoc/next.js'
import { DOC_REDIRECTS } from './lib/redirects.mjs'

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['js', 'jsx', 'ts', 'tsx', 'md', 'mdoc'],
  serverExternalPackages: ['shiki'],
  turbopack: {}, // Empty turbopack config to silence warning
  async redirects() {
    return DOC_REDIRECTS.map(([source, destination]) => ({
      source,
      destination,
      permanent: true,
    }))
  },
}

export default withMarkdoc()(nextConfig)
