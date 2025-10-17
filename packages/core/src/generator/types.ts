import type {
  OpenSaaSConfig,
  FieldConfig,
  RelationshipField,
} from "../config/types.js";
import * as fs from "fs";
import * as path from "path";

/**
 * Map OpenSaaS field types to TypeScript types
 */
function mapFieldTypeToTypeScript(field: FieldConfig): string {
  switch (field.type) {
    case "text":
      return "string";
    case "integer":
      return "number";
    case "checkbox":
      return "boolean";
    case "timestamp":
      return "Date";
    case "password":
      return "string";
    case "select":
      // Generate union type from options
      return field.options.map((opt) => `'${opt.value}'`).join(" | ");
    case "relationship":
      return ""; // Handled separately
    default:
      throw new Error(`Unknown field type: ${(field as any).type}`);
  }
}

/**
 * Check if a field is optional in the type
 */
function isFieldOptional(field: FieldConfig): boolean {
  if (field.type === "relationship") {
    return true;
  }

  if ("validation" in field && field.validation?.isRequired) {
    return false;
  }

  return true;
}

/**
 * Generate TypeScript interface for a model
 */
function generateModelType(
  listName: string,
  fields: Record<string, FieldConfig>,
): string {
  const lines: string[] = [];

  lines.push(`export type ${listName} = {`);
  lines.push("  id: string");

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (fieldConfig.type === "relationship") {
      const relField = fieldConfig as RelationshipField;
      const [targetList] = relField.ref.split(".");

      if (relField.many) {
        lines.push(`  ${fieldName}: ${targetList}[]`);
      } else {
        lines.push(`  ${fieldName}Id: string | null`);
        lines.push(`  ${fieldName}: ${targetList} | null`);
      }
    } else {
      const tsType = mapFieldTypeToTypeScript(fieldConfig);
      const optional = isFieldOptional(fieldConfig);
      const nullability = optional ? " | null" : "";
      lines.push(`  ${fieldName}: ${tsType}${nullability}`);
    }
  }

  lines.push("  createdAt: Date");
  lines.push("  updatedAt: Date");
  lines.push("}");

  return lines.join("\n");
}

/**
 * Generate CreateInput type
 */
function generateCreateInputType(
  listName: string,
  fields: Record<string, FieldConfig>,
): string {
  const lines: string[] = [];

  lines.push(`export type ${listName}CreateInput = {`);

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (fieldConfig.type === "relationship") {
      const relField = fieldConfig as RelationshipField;

      if (relField.many) {
        lines.push(`  ${fieldName}?: { connect: Array<{ id: string }> }`);
      } else {
        lines.push(`  ${fieldName}?: { connect: { id: string } }`);
      }
    } else {
      const tsType = mapFieldTypeToTypeScript(fieldConfig);
      const required =
        !isFieldOptional(fieldConfig) && !fieldConfig.defaultValue;
      const optional = required ? "" : "?";
      lines.push(`  ${fieldName}${optional}: ${tsType}`);
    }
  }

  lines.push("}");

  return lines.join("\n");
}

/**
 * Generate UpdateInput type
 */
function generateUpdateInputType(
  listName: string,
  fields: Record<string, FieldConfig>,
): string {
  const lines: string[] = [];

  lines.push(`export type ${listName}UpdateInput = {`);

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (fieldConfig.type === "relationship") {
      const relField = fieldConfig as RelationshipField;

      if (relField.many) {
        lines.push(
          `  ${fieldName}?: { connect: Array<{ id: string }>, disconnect: Array<{ id: string }> }`,
        );
      } else {
        lines.push(
          `  ${fieldName}?: { connect: { id: string } } | { disconnect: true }`,
        );
      }
    } else {
      const tsType = mapFieldTypeToTypeScript(fieldConfig);
      lines.push(`  ${fieldName}?: ${tsType}`);
    }
  }

  lines.push("}");

  return lines.join("\n");
}

/**
 * Generate WhereInput type (simplified)
 */
function generateWhereInputType(
  listName: string,
  fields: Record<string, FieldConfig>,
): string {
  const lines: string[] = [];

  lines.push(`export type ${listName}WhereInput = {`);
  lines.push("  id?: string");
  lines.push("  AND?: Array<" + listName + "WhereInput>");
  lines.push("  OR?: Array<" + listName + "WhereInput>");
  lines.push("  NOT?: " + listName + "WhereInput");

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (fieldConfig.type === "relationship") {
      continue; // Skip for now
    } else {
      const tsType = mapFieldTypeToTypeScript(fieldConfig);
      lines.push(`  ${fieldName}?: { equals?: ${tsType}, not?: ${tsType} }`);
    }
  }

  lines.push("}");

  return lines.join("\n");
}

/**
 * Generate Context type with all operations
 */
function generateContextType(config: OpenSaaSConfig): string {
  const lines: string[] = [];

  lines.push("export type Context = {");
  lines.push("  db: {");

  for (const listName of Object.keys(config.lists)) {
    const lowerName = listName.toLowerCase();

    lines.push(`    ${lowerName}: {`);
    lines.push(`      findUnique: (args: {`);
    lines.push(`        where: { id: string }`);
    lines.push(`        include?: any`);
    lines.push(`      }) => Promise<${listName} | null>`);
    lines.push(`      findMany: (args?: {`);
    lines.push(`        where?: ${listName}WhereInput`);
    lines.push(`        take?: number`);
    lines.push(`        skip?: number`);
    lines.push(`        include?: any`);
    lines.push(`      }) => Promise<${listName}[]>`);
    lines.push(`      create: (args: {`);
    lines.push(`        data: ${listName}CreateInput`);
    lines.push(`      }) => Promise<${listName} | null>`);
    lines.push(`      update: (args: {`);
    lines.push(`        where: { id: string }`);
    lines.push(`        data: ${listName}UpdateInput`);
    lines.push(`      }) => Promise<${listName} | null>`);
    lines.push(`      delete: (args: {`);
    lines.push(`        where: { id: string }`);
    lines.push(`      }) => Promise<${listName} | null>`);
    lines.push(`      count: (args?: {`);
    lines.push(`        where?: ${listName}WhereInput`);
    lines.push(`      }) => Promise<number>`);
    lines.push(`    }`);
  }

  lines.push("  }");
  lines.push("  session: any");
  lines.push("  prisma: any  // Your PrismaClient instance");
  lines.push("}");

  return lines.join("\n");
}

/**
 * Generate all TypeScript types from config
 */
export function generateTypes(config: OpenSaaSConfig): string {
  const lines: string[] = [];

  // Add header comment
  lines.push("/**");
  lines.push(" * Generated types from OpenSaaS configuration");
  lines.push(" * DO NOT EDIT - This file is automatically generated");
  lines.push(" */");
  lines.push("");

  // Generate types for each list
  for (const [listName, listConfig] of Object.entries(config.lists)) {
    lines.push(generateModelType(listName, listConfig.fields));
    lines.push("");
    lines.push(generateCreateInputType(listName, listConfig.fields));
    lines.push("");
    lines.push(generateUpdateInputType(listName, listConfig.fields));
    lines.push("");
    lines.push(generateWhereInputType(listName, listConfig.fields));
    lines.push("");
  }

  // Generate Context type
  lines.push(generateContextType(config));

  return lines.join("\n");
}

/**
 * Write TypeScript types to file
 */
export function writeTypes(config: OpenSaaSConfig, outputPath: string): void {
  const types = generateTypes(config);

  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, types, "utf-8");
}
