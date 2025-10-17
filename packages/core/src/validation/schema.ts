import { z } from "zod";
import type { FieldConfig } from "../config/types.js";

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

    // Use the field's schema generator
    if (fieldConfig.getZodSchema) {
      shape[fieldName] = fieldConfig.getZodSchema(fieldName, operation);
    } else {
      // Fallback for custom field types without schema generators
      shape[fieldName] = z.any().optional();
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
