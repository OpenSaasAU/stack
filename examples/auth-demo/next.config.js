/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@prisma/client', '@opensaas/stack-core', '@opensaas/stack-ui'],
}
// eslint-disable-next-line no-undef
module.exports = nextConfig
