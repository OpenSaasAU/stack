/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@prisma/client", "@opensaas/core", "@opensaas/ui"],
};
// eslint-disable-next-line no-undef
module.exports = nextConfig;
