import { z } from "zod";
import type {
  TextField,
  IntegerField,
  CheckboxField,
  TimestampField,
  PasswordField,
  SelectField,
  RelationshipField,
} from "../config/types.js";

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
 * Text field
 */
export function text(options?: Omit<TextField, "type">): TextField {
  return {
    type: "text",
    ...options,
    getZodSchema: (fieldName: string, operation: "create" | "update") => {
      const validation = options?.validation;
      const isRequired = validation?.isRequired;

      let schema: z.ZodTypeAny;

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
        if (min !== undefined && (schema as any).unwrap) {
          const baseSchema = (schema as any).unwrap() as z.ZodString;
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
        if (max !== undefined && (schema as any).unwrap) {
          const baseSchema = (schema as any).unwrap() as z.ZodString;
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

      return schema;
    },
    getPrismaType: (fieldName: string) => {
      const validation = options?.validation;
      const isRequired = validation?.isRequired;
      let modifiers = "";

      // Optional modifier
      if (!isRequired) {
        modifiers += "?";
      }

      // Unique/index modifiers
      if (options?.isIndexed === "unique") {
        modifiers += " @unique";
      } else if (options?.isIndexed === true) {
        modifiers += " @index";
      }

      return {
        type: "String",
        modifiers: modifiers || undefined,
      };
    },
    getTypeScriptType: () => {
      const validation = options?.validation;
      const isRequired = validation?.isRequired;

      return {
        type: "string",
        optional: !isRequired,
      };
    },
  };
}

/**
 * Integer field
 */
export function integer(options?: Omit<IntegerField, "type">): IntegerField {
  return {
    type: "integer",
    ...options,
    getZodSchema: (fieldName: string, operation: "create" | "update") => {
      let schema: z.ZodTypeAny = z.number({
        message: `${formatFieldName(fieldName)} must be a number`,
      });

      // Add min/max constraints
      if (options?.validation?.min !== undefined) {
        schema = (schema as z.ZodNumber).min(options.validation.min, {
          message: `${formatFieldName(fieldName)} must be at least ${options.validation.min}`,
        });
      }
      if (options?.validation?.max !== undefined) {
        schema = (schema as z.ZodNumber).max(options.validation.max, {
          message: `${formatFieldName(fieldName)} must be at most ${options.validation.max}`,
        });
      }

      // Make optional if not required or if update operation
      if (!options?.validation?.isRequired || operation === "update") {
        schema = schema.optional();
      }

      return schema;
    },
    getPrismaType: (fieldName: string) => {
      const isRequired = options?.validation?.isRequired;

      return {
        type: "Int",
        modifiers: isRequired ? undefined : "?",
      };
    },
    getTypeScriptType: () => {
      const isRequired = options?.validation?.isRequired;

      return {
        type: "number",
        optional: !isRequired,
      };
    },
  };
}

/**
 * Checkbox (boolean) field
 */
export function checkbox(options?: Omit<CheckboxField, "type">): CheckboxField {
  return {
    type: "checkbox",
    ...options,
    getZodSchema: (fieldName: string, operation: "create" | "update") => {
      return z.boolean().optional();
    },
    getPrismaType: (fieldName: string) => {
      const hasDefault = options?.defaultValue !== undefined;
      let modifiers = "";

      if (hasDefault) {
        modifiers = ` @default(${options.defaultValue})`;
      }

      return {
        type: "Boolean",
        modifiers: modifiers || undefined,
      };
    },
    getTypeScriptType: () => {
      return {
        type: "boolean",
        optional: options?.defaultValue === undefined,
      };
    },
  };
}

/**
 * Timestamp (DateTime) field
 */
export function timestamp(
  options?: Omit<TimestampField, "type">,
): TimestampField {
  return {
    type: "timestamp",
    ...options,
    getZodSchema: (fieldName: string, operation: "create" | "update") => {
      return z.union([z.date(), z.string().datetime()]).optional();
    },
    getPrismaType: (fieldName: string) => {
      let modifiers = "?";

      // Check for default value
      if (
        options?.defaultValue &&
        typeof options.defaultValue === "object" &&
        options.defaultValue.kind === "now"
      ) {
        modifiers = " @default(now())";
      }

      return {
        type: "DateTime",
        modifiers,
      };
    },
    getTypeScriptType: () => {
      const hasDefault =
        options?.defaultValue &&
        typeof options.defaultValue === "object" &&
        options.defaultValue.kind === "now";

      return {
        type: "Date",
        optional: !hasDefault,
      };
    },
  };
}

/**
 * Password field (automatically hashed)
 */
export function password(options?: Omit<PasswordField, "type">): PasswordField {
  return {
    type: "password",
    ...options,
    getZodSchema: (fieldName: string, operation: "create" | "update") => {
      const validation = options?.validation;
      const isRequired = validation?.isRequired;

      if (isRequired && operation === "create") {
        // Required in create mode: reject undefined and empty strings
        return z
          .string({
            message: `${formatFieldName(fieldName)} must be text`,
          })
          .min(1, {
            message: `${formatFieldName(fieldName)} is required`,
          });
      } else if (isRequired && operation === "update") {
        // Required in update mode: if provided, reject empty strings
        return z.union([
          z.string().min(1, {
            message: `${formatFieldName(fieldName)} is required`,
          }),
          z.undefined(),
        ]);
      } else {
        // Not required: can be undefined or any string
        return z
          .string({
            message: `${formatFieldName(fieldName)} must be text`,
          })
          .optional();
      }
    },
    getPrismaType: (fieldName: string) => {
      const isRequired = options?.validation?.isRequired;

      return {
        type: "String",
        modifiers: isRequired ? undefined : "?",
      };
    },
    getTypeScriptType: () => {
      const isRequired = options?.validation?.isRequired;

      return {
        type: "string",
        optional: !isRequired,
      };
    },
  };
}

/**
 * Select field (enum-like)
 */
export function select(options: Omit<SelectField, "type">): SelectField {
  if (!options.options || options.options.length === 0) {
    throw new Error("Select field must have at least one option");
  }

  return {
    type: "select",
    ...options,
    getZodSchema: (fieldName: string, operation: "create" | "update") => {
      const values = options.options.map((opt) => opt.value);
      let schema: z.ZodTypeAny = z.enum(values as [string, ...string[]], {
        message: `${formatFieldName(fieldName)} must be one of: ${values.join(", ")}`,
      });

      if (!options.validation?.isRequired || operation === "update") {
        schema = schema.optional();
      }

      return schema;
    },
    getPrismaType: (fieldName: string) => {
      let modifiers = "?";

      // Add default value if provided
      if (options.defaultValue !== undefined) {
        modifiers = ` @default("${options.defaultValue}")`;
      }

      return {
        type: "String",
        modifiers,
      };
    },
    getTypeScriptType: () => {
      // Generate union type from options
      const unionType = options.options.map((opt) => `'${opt.value}'`).join(" | ");

      return {
        type: unionType,
        optional: !options.validation?.isRequired || options.defaultValue !== undefined,
      };
    },
  };
}

/**
 * Relationship field
 */
export function relationship(
  options: Omit<RelationshipField, "type">,
): RelationshipField {
  if (!options.ref) {
    throw new Error("Relationship field must have a ref");
  }

  // Validate ref format: 'ListName.fieldName'
  const refParts = options.ref.split(".");
  if (refParts.length !== 2) {
    throw new Error(
      `Invalid relationship ref format: "${options.ref}". Expected format: "ListName.fieldName"`,
    );
  }

  return {
    type: "relationship",
    ...options,
  };
}
