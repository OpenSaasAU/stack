import type {
  OpenSaaSConfig,
  FieldConfig,
  RelationshipField,
} from "../config/types.js";
import * as fs from "fs";
import * as path from "path";

/**
 * Map OpenSaaS field types to Prisma field types
 */
function mapFieldTypeToPrisma(field: FieldConfig): string {
  switch (field.type) {
    case "text":
      return "String";
    case "integer":
      return "Int";
    case "checkbox":
      return "Boolean";
    case "timestamp":
      return "DateTime";
    case "password":
      return "String";
    case "select":
      return "String";
    case "relationship":
      // Relationships are handled separately
      return "";
    default:
      throw new Error(`Unknown field type: ${(field as any).type}`);
  }
}

/**
 * Check if a field is optional
 */
function isFieldOptional(field: FieldConfig): boolean {
  // Relationships are handled separately
  if (field.type === "relationship") {
    return true;
  }

  // Check if field has required validation
  if ("validation" in field && field.validation?.isRequired) {
    return false;
  }

  // Checkbox with default value is not optional
  if (field.type === "checkbox" && field.defaultValue !== undefined) {
    return false;
  }

  // Timestamp with default value is not optional
  if (field.type === "timestamp" && field.defaultValue !== undefined) {
    return false;
  }

  // All other fields are optional by default
  return true;
}

/**
 * Get field modifiers (?, @default, @unique, etc.)
 */
function getFieldModifiers(fieldName: string, field: FieldConfig): string {
  let modifiers = "";

  // Handle relationships separately
  if (field.type === "relationship") {
    const relField = field as RelationshipField;
    if (relField.many) {
      modifiers = "[]";
    } else {
      modifiers = "?";
    }
    return modifiers;
  }

  // Check if optional
  if (isFieldOptional(field)) {
    modifiers += "?";
  }

  // Handle defaults
  if (field.defaultValue !== undefined) {
    if (field.type === "checkbox" && typeof field.defaultValue === "boolean") {
      modifiers += ` @default(${field.defaultValue})`;
    } else if (
      field.type === "select" &&
      typeof field.defaultValue === "string"
    ) {
      modifiers += ` @default("${field.defaultValue}")`;
    } else if (
      field.type === "timestamp" &&
      typeof field.defaultValue === "object" &&
      field.defaultValue.kind === "now"
    ) {
      modifiers += " @default(now())";
    }
  }

  // Handle unique index
  if (field.type === "text" && field.isIndexed === "unique") {
    modifiers += " @unique";
  } else if (field.type === "text" && field.isIndexed === true) {
    modifiers += " @index";
  }

  return modifiers;
}

/**
 * Parse relationship ref to get target list and field
 */
function parseRelationshipRef(ref: string): { list: string; field: string } {
  const [list, field] = ref.split(".");
  if (!list || !field) {
    throw new Error(`Invalid relationship ref: ${ref}`);
  }
  return { list, field };
}

/**
 * Generate Prisma schema from OpenSaaS config
 */
export function generatePrismaSchema(config: OpenSaaSConfig): string {
  const lines: string[] = [];

  // Generator and datasource
  lines.push("generator client {");
  lines.push('  provider = "prisma-client-js"');
  lines.push("}");
  lines.push("");
  lines.push("datasource db {");
  lines.push(`  provider = "${config.db.provider}"`);
  lines.push('  url      = env("DATABASE_URL")');
  lines.push("}");
  lines.push("");

  // Generate models for each list
  for (const [listName, listConfig] of Object.entries(config.lists)) {
    lines.push(`model ${listName} {`);

    // Always add id field
    lines.push("  id        String   @id @default(cuid())");

    // Track relationship fields for later processing
    const relationshipFields: Array<{
      name: string;
      field: RelationshipField;
    }> = [];

    // Add regular fields
    for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
      if (fieldConfig.type === "relationship") {
        relationshipFields.push({
          name: fieldName,
          field: fieldConfig as RelationshipField,
        });
        continue;
      }

      const prismaType = mapFieldTypeToPrisma(fieldConfig);
      const modifiers = getFieldModifiers(fieldName, fieldConfig);

      // Format with proper spacing
      const paddedName = fieldName.padEnd(12);
      lines.push(`  ${paddedName} ${prismaType}${modifiers}`);
    }

    // Add relationship fields
    for (const { name: fieldName, field: relField } of relationshipFields) {
      const { list: targetList } = parseRelationshipRef(relField.ref);
      const modifiers = getFieldModifiers(fieldName, relField);
      const paddedName = fieldName.padEnd(12);

      if (relField.many) {
        // One-to-many relationship
        lines.push(`  ${paddedName} ${targetList}[]`);
      } else {
        // Many-to-one relationship (add foreign key field)
        const foreignKeyField = `${fieldName}Id`;
        const fkPaddedName = foreignKeyField.padEnd(12);

        lines.push(`  ${fkPaddedName} String?`);
        lines.push(
          `  ${paddedName} ${targetList}?  @relation(fields: [${foreignKeyField}], references: [id])`,
        );
      }
    }

    // Always add timestamps
    lines.push("  createdAt DateTime @default(now())");
    lines.push("  updatedAt DateTime @updatedAt");

    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Write Prisma schema to file
 */
export function writePrismaSchema(
  config: OpenSaaSConfig,
  outputPath: string,
): void {
  const schema = generatePrismaSchema(config);

  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, schema, "utf-8");
}
