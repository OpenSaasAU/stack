import { z } from "zod";
import type { FieldConfig } from "../config/types.js";
import { text, integer, checkbox, timestamp, password, select } from "../fields/index.js";

/**
 * Generate Zod schema from field configurations
 */
export function generateZodSchema(
  fieldConfigs: Record<string, FieldConfig>,
  operation: "create" | "update" = "create",
): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    // Skip system fields and relationships
    if (
      ["id", "createdAt", "updatedAt"].includes(fieldName) ||
      fieldConfig.type === "relationship"
    ) {
      continue;
    }

    // Use the field's schema generator if available
    if (fieldConfig.getZodSchema) {
      shape[fieldName] = fieldConfig.getZodSchema(fieldName, operation);
    } else {
      // Fallback: create a temporary field config with the schema generator
      // This handles plain config objects (used in tests)
      let tempField: FieldConfig;

      switch (fieldConfig.type) {
        case "text":
          tempField = text({ validation: fieldConfig.validation, isIndexed: fieldConfig.isIndexed, ui: fieldConfig.ui, access: fieldConfig.access, defaultValue: fieldConfig.defaultValue });
          break;
        case "password":
          tempField = password({ validation: fieldConfig.validation, access: fieldConfig.access, defaultValue: fieldConfig.defaultValue });
          break;
        case "integer":
          tempField = integer({ validation: fieldConfig.validation, access: fieldConfig.access, defaultValue: fieldConfig.defaultValue });
          break;
        case "checkbox":
          tempField = checkbox({ access: fieldConfig.access, defaultValue: fieldConfig.defaultValue });
          break;
        case "timestamp":
          tempField = timestamp({ defaultValue: fieldConfig.defaultValue, access: fieldConfig.access });
          break;
        case "select":
          tempField = select({ options: fieldConfig.options, validation: fieldConfig.validation, ui: fieldConfig.ui, access: fieldConfig.access, defaultValue: fieldConfig.defaultValue });
          break;
        default:
          // Unknown field type
          shape[fieldName] = z.any().optional();
          continue;
      }

      if (tempField.getZodSchema) {
        shape[fieldName] = tempField.getZodSchema(fieldName, operation);
      } else {
        shape[fieldName] = z.any().optional();
      }
    }
  }

  return z.object(shape);
}

/**
 * Validate data against field configurations using Zod
 * Returns structured errors by field
 */
export function validateWithZod(
  data: Record<string, any>,
  fieldConfigs: Record<string, FieldConfig>,
  operation: "create" | "update" = "create",
): { success: true } | { success: false; errors: Record<string, string> } {
  const schema = generateZodSchema(fieldConfigs, operation);

  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true };
  }

  // Convert Zod errors to field-specific error messages
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const fieldPath = issue.path.join(".");
    errors[fieldPath] = issue.message;
  }

  return { success: false, errors };
}
