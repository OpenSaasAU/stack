import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import chalk from "chalk";
import ora from "ora";

export async function generateCommand() {
  console.log(chalk.bold("\n🚀 OpenSaaS Generator\n"));

  const cwd = process.cwd();
  const configPath = path.join(cwd, "opensaas.config.ts");

  // Check if config exists
  if (!fs.existsSync(configPath)) {
    console.error(chalk.red("❌ Error: opensaas.config.ts not found in current directory"));
    console.error(chalk.gray("   Please run this command from your project root"));
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

    // Create a temporary script that imports the config and runs generation
    const generatorScript = `
import config from './opensaas.config.ts';
import { writePrismaSchema, writeTypes } from '@opensaas/cli/generator';

writePrismaSchema(config, './prisma/schema.prisma');
writeTypes(config, './.opensaas/types.ts');
`;

    const scriptPath = path.join(cwd, ".opensaas-generator.tmp.ts");
    fs.writeFileSync(scriptPath, generatorScript);

    try {
      // Use tsx to run the generator script
      const tsxBin = path.join(cwd, "node_modules", ".bin", "tsx");
      execSync(`"${tsxBin}" "${scriptPath}"`, {
        cwd,
        encoding: "utf-8",
        stdio: "pipe",
      });

      spinner.succeed(chalk.green("Generation complete"));
      console.log(chalk.green("✅ Prisma schema generated"));
      console.log(chalk.green("✅ TypeScript types generated"));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      spinner.fail(chalk.red("Failed to generate"));
      const errorOutput = err.stderr || err.stdout || err.message;
      console.error(chalk.red("\n❌ Error:"), errorOutput);
      process.exit(1);
    } finally {
      // Cleanup generator script
      if (fs.existsSync(scriptPath)) {
        fs.unlinkSync(scriptPath);
      }
    }

    console.log(chalk.bold("\n✨ Generation complete!\n"));
    console.log(chalk.gray("Next steps:"));
    console.log(chalk.gray("  1. Run: npx prisma generate"));
    console.log(chalk.gray("  2. Run: npx prisma db push"));
    console.log(chalk.gray("  3. Start using your generated types!\n"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    spinner.fail(chalk.red("Generation failed"));
    console.error(chalk.red("\n❌ Error:"), error.message);
    if (error.stack) {
      console.error(chalk.gray("\n" + error.stack));
    }
    process.exit(1);
  }
}
