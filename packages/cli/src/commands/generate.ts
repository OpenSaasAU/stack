import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import chalk from "chalk";
import ora from "ora";
import { writePrismaSchema, writeTypes } from "@opensaas/core";

export async function generateCommand() {
  console.log(chalk.bold("\n🚀 OpenSaaS Generator\n"));

  const cwd = process.cwd();
  const configPath = path.join(cwd, "opensaas.config.ts");

  // Check if config exists
  if (!fs.existsSync(configPath)) {
    console.error(
      chalk.red("❌ Error: opensaas.config.ts not found in current directory"),
    );
    console.error(
      chalk.gray("   Please run this command from your project root"),
    );
    process.exit(1);
  }

  const spinner = ora("Loading configuration...").start();

  try {
    // Check if tsx is installed
    const tsxPath = path.join(cwd, "node_modules", "tsx");
    if (!fs.existsSync(tsxPath)) {
      spinner.fail(chalk.red("Failed to load configuration"));
      console.error(chalk.red("\n❌ tsx is not installed"));
      console.error(chalk.gray("   Install it with: pnpm add -D tsx"));
      process.exit(1);
    }

    // Create a temporary script to load and serialize the config
    const loaderScript = `
      const config = require('${configPath}');
      const opensaasConfig = config.default || config;
      console.log(JSON.stringify(opensaasConfig));
    `;

    const loaderScriptPath = path.join(cwd, ".opensaas-loader.tmp.js");
    fs.writeFileSync(loaderScriptPath, loaderScript);

    let configJson: string;
    try {
      // Use tsx to execute the loader script
      const tsxBin = path.join(cwd, "node_modules", ".bin", "tsx");
      configJson = execSync(`"${tsxBin}" "${loaderScriptPath}"`, {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: any) {
      spinner.fail(chalk.red("Failed to load configuration"));
      console.error(chalk.red("\n❌ Error loading config:"), err.message);
      // Cleanup
      if (fs.existsSync(loaderScriptPath)) {
        fs.unlinkSync(loaderScriptPath);
      }
      process.exit(1);
    } finally {
      // Cleanup loader script
      if (fs.existsSync(loaderScriptPath)) {
        fs.unlinkSync(loaderScriptPath);
      }
    }

    const opensaasConfig = JSON.parse(configJson);

    if (!opensaasConfig || !opensaasConfig.lists) {
      spinner.fail(chalk.red("Invalid configuration"));
      console.error(
        chalk.red("\n❌ Config must export a valid OpenSaaS config"),
      );
      console.error(chalk.gray("   Expected: export default config({ ... })"));
      process.exit(1);
    }

    spinner.succeed(chalk.green("Configuration loaded"));

    // Generate Prisma schema
    spinner.start("Generating Prisma schema...");
    const prismaSchemaPath = path.join(cwd, "prisma", "schema.prisma");
    writePrismaSchema(opensaasConfig, prismaSchemaPath);
    spinner.succeed(chalk.green("Prisma schema generated"));

    // Generate TypeScript types
    spinner.start("Generating TypeScript types...");
    const typesPath = path.join(cwd, ".opensaas", "types.ts");
    writeTypes(opensaasConfig, typesPath);
    spinner.succeed(chalk.green("TypeScript types generated"));

    console.log(chalk.bold("\n✨ Generation complete!\n"));
    console.log(chalk.gray("Next steps:"));
    console.log(chalk.gray("  1. Run: npx prisma generate"));
    console.log(chalk.gray("  2. Run: npx prisma db push"));
    console.log(chalk.gray("  3. Start using your generated types!\n"));
  } catch (error: any) {
    spinner.fail(chalk.red("Generation failed"));
    console.error(chalk.red("\n❌ Error:"), error.message);
    if (error.stack) {
      console.error(chalk.gray("\n" + error.stack));
    }
    process.exit(1);
  }
}
