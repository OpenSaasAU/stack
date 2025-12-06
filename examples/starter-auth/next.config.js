/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@prisma/client', 'better-sqlite3'],
  transpilePackages: ['@opensaas/stack-ui', '@opensaas/stack-core', '@opensaas/stack-auth'],
}
// eslint-disable-next-line no-undef
module.exports = nextConfig
