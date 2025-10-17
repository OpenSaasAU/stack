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
    // TODO: Make this not any
    let schema: any;

    switch (fieldConfig.type) {
      case "text":
      case "password": {
        const validation = fieldConfig.validation;
        const isRequired = validation?.isRequired;

        if (isRequired && operation === "create") {
          // Required in create mode: reject undefined and empty strings
          schema = z
            .string({
              message: `${formatFieldName(fieldName)} must be text`,
            })
            .min(1, {
              message: `${formatFieldName(fieldName)} is required`,
            });
        } else if (isRequired && operation === "update") {
          // Required in update mode: if provided, reject empty strings
          schema = z.union([
            z.string().min(1, {
              message: `${formatFieldName(fieldName)} is required`,
            }),
            z.undefined(),
          ]);
        } else {
          // Not required: can be undefined or any string
          schema = z
            .string({
              message: `${formatFieldName(fieldName)} must be text`,
            })
            .optional();
        }

        // Add length constraints
        if (validation && "length" in validation && validation.length) {
          const { min, max } = validation.length;
          if (min !== undefined && schema.unwrap) {
            const baseSchema = schema.unwrap() as z.ZodString;
            schema = baseSchema
              .min(min, {
                message: `${formatFieldName(fieldName)} must be at least ${min} characters`,
              })
              .optional();
          } else if (min !== undefined) {
            schema = (schema as z.ZodString).min(min, {
              message: `${formatFieldName(fieldName)} must be at least ${min} characters`,
            });
          }
          if (max !== undefined && schema.unwrap) {
            const baseSchema = schema.unwrap() as z.ZodString;
            schema = baseSchema
              .max(max, {
                message: `${formatFieldName(fieldName)} must be at most ${max} characters`,
              })
              .optional();
          } else if (max !== undefined) {
            schema = (schema as z.ZodString).max(max, {
              message: `${formatFieldName(fieldName)} must be at most ${max} characters`,
            });
          }
        }
        break;
      }

      case "integer": {
        schema = z.number({
          message: `${formatFieldName(fieldName)} must be a number`,
        });

        // Add min/max constraints
        if (fieldConfig.validation?.min !== undefined) {
          schema = (schema as z.ZodNumber).min(fieldConfig.validation.min, {
            message: `${formatFieldName(fieldName)} must be at least ${fieldConfig.validation.min}`,
          });
        }
        if (fieldConfig.validation?.max !== undefined) {
          schema = (schema as z.ZodNumber).max(fieldConfig.validation.max, {
            message: `${formatFieldName(fieldName)} must be at most ${fieldConfig.validation.max}`,
          });
        }

        // Make optional if not required or if update operation
        if (!fieldConfig.validation?.isRequired || operation === "update") {
          schema = schema.optional();
        }
        break;
      }

      case "checkbox": {
        schema = z.boolean().optional();
        break;
      }

      case "select": {
        const values = fieldConfig.options.map((opt) => opt.value);
        schema = z.enum(values as [string, ...string[]], {
          message: `${formatFieldName(fieldName)} must be one of: ${values.join(", ")}`,
        });

        if (!fieldConfig.validation?.isRequired || operation === "update") {
          schema = schema.optional();
        }
        break;
      }

      case "timestamp": {
        schema = z.union([z.date(), z.string().datetime()]).optional();
        break;
      }

      default:
        schema = z.any().optional();
    }

    shape[fieldName] = schema;
  }

  return z.object(shape);
}

/**
 * Format field name for display in error messages
 */
function formatFieldName(fieldName: string): string {
  return fieldName
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
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
