/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@prisma/client", "@opensaas/core", "@opensaas/ui"],
};

module.exports = nextConfig;
