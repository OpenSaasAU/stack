#!/usr/bin/env node

/**
 * OpenSaaS Generator CLI
 * Generates Prisma schema and TypeScript types from opensaas.config.ts
 */

const path = require("path");
const fs = require("fs");

async function main() {
  console.log("🚀 OpenSaaS Generator");
  console.log("");

  try {
    // Find the project root (where opensaas.config.ts exists)
    const cwd = process.cwd();
    const configPath = path.join(cwd, "opensaas.config.ts");

    if (!fs.existsSync(configPath)) {
      console.error(
        "❌ Error: opensaas.config.ts not found in current directory",
      );
      console.error("   Please run this command from your project root");
      process.exit(1);
    }

    console.log("📖 Reading config from:", configPath);

    // Register tsx loader to handle TypeScript files
    let config;
    try {
      // Look for tsx in the project's node_modules
      const tsxCjsPath = path.join(
        cwd,
        "node_modules",
        "tsx",
        "dist",
        "cjs",
        "index.cjs",
      );

      if (fs.existsSync(tsxCjsPath)) {
        // Load tsx from project's node_modules
        require(tsxCjsPath);
      } else {
        // Try loading from global or core's node_modules
        require("tsx/cjs");
      }

      // Now require the TypeScript config file
      config = require(configPath);
    } catch (err) {
      // Check if tsx is installed
      const tsxPath = path.join(cwd, "node_modules", "tsx");
      if (!fs.existsSync(tsxPath)) {
        console.error("❌ Error: tsx is not installed in your project");
        console.error("   Please install it: pnpm add -D tsx");
        console.error("   Or: npm install -D tsx");
        process.exit(1);
      }

      // tsx exists but failed to load config
      console.error("❌ Error: Unable to load TypeScript config");
      console.error("   Make sure your opensaas.config.ts is valid");
      console.error("");
      console.error("   Error details:", err.message);
      console.error("");
      if (err.stack) {
        console.error(err.stack);
      }
      process.exit(1);
    }

    const opensaasConfig = config.default || config;

    if (!opensaasConfig || !opensaasConfig.lists) {
      console.error(
        "❌ Error: Invalid config - must export a valid OpenSaaS config",
      );
      console.error("   Expected: export default config({ ... })");
      process.exit(1);
    }

    // Import generator functions from the built core package
    const { writePrismaSchema, writeTypes } = require("../dist/generator");

    // Generate Prisma schema
    console.log("⚙️  Generating Prisma schema...");
    const prismaSchemaPath = path.join(cwd, "prisma", "schema.prisma");
    writePrismaSchema(opensaasConfig, prismaSchemaPath);
    console.log("✅ Prisma schema written to:", prismaSchemaPath);

    // Generate TypeScript types
    console.log("⚙️  Generating TypeScript types...");
    const typesPath = path.join(cwd, ".opensaas", "types.ts");
    writeTypes(opensaasConfig, typesPath);
    console.log("✅ Types written to:", typesPath);

    console.log("");
    console.log("🎉 Generation complete!");
    console.log("");
    console.log("Next steps:");
    console.log("  1. Run: npx prisma generate");
    console.log("  2. Run: npx prisma db push");
    console.log("  3. Start using your generated types!");
  } catch (error) {
    console.error("❌ Error during generation:", error.message);
    console.error("");
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
