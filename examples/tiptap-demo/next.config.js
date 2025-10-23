/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@opensaas/framework-core',
    '@opensaas/framework-ui',
    '@opensaas/framework-tiptap',
  ],
}

module.exports = nextConfig
