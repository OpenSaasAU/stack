/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@prisma/client'],
  transpilePackages: ['@opensaas/stack-ui', '@opensaas/stack-core', '@opensaas/stack-auth'],
}
// eslint-disable-next-line no-undef
module.exports = nextConfig
