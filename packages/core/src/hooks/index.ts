import type { Hooks } from "../config/types.js";

/**
 * Validation error collection
 */
export class ValidationError extends Error {
  public errors: string[];

  constructor(errors: string[]) {
    super(`Validation failed: ${errors.join(", ")}`);
    this.name = "ValidationError";
    this.errors = errors;
  }
}

/**
 * Execute resolveInput hook
 * Allows modification of input data before validation
 */
export async function executeResolveInput<T = any>(
  hooks: Hooks<T> | undefined,
  args: {
    operation: "create" | "update";
    resolvedData: Partial<T>;
    item?: T;
    context: any;
  },
): Promise<Partial<T>> {
  if (!hooks?.resolveInput) {
    return args.resolvedData;
  }

  const result = await hooks.resolveInput(args);
  return result;
}

/**
 * Execute validateInput hook
 * Allows custom validation logic
 */
export async function executeValidateInput<T = any>(
  hooks: Hooks<T> | undefined,
  args: {
    operation: "create" | "update";
    resolvedData: Partial<T>;
    item?: T;
    context: any;
  },
): Promise<void> {
  if (!hooks?.validateInput) {
    return;
  }

  const errors: string[] = [];

  const addValidationError = (msg: string) => {
    errors.push(msg);
  };

  await hooks.validateInput({
    ...args,
    addValidationError,
  });

  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
}

/**
 * Execute beforeOperation hook
 * Runs before database operation (cannot modify data)
 */
export async function executeBeforeOperation<T = any>(
  hooks: Hooks<T> | undefined,
  args: {
    operation: "create" | "update" | "delete";
    item?: T;
    context: any;
  },
): Promise<void> {
  if (!hooks?.beforeOperation) {
    return;
  }

  await hooks.beforeOperation(args);
}

/**
 * Execute afterOperation hook
 * Runs after database operation
 */
export async function executeAfterOperation<T = any>(
  hooks: Hooks<T> | undefined,
  args: {
    operation: "create" | "update" | "delete";
    item: T;
    context: any;
  },
): Promise<void> {
  if (!hooks?.afterOperation) {
    return;
  }

  await hooks.afterOperation(args);
}

/**
 * Validate field-level validation rules
 * Checks isRequired, length constraints, etc.
 */
export function validateFieldRules(
  data: Record<string, any>,
  fieldConfigs: Record<string, any>,
  operation?: "create" | "update",
): string[] {
  const errors: string[] = [];

  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    // Skip relationships and system fields
    if (
      fieldConfig.type === "relationship" ||
      ["id", "createdAt", "updatedAt"].includes(fieldName)
    ) {
      continue;
    }

    const value = data[fieldName];

    // Check required validation (only on create, or if field is present in update)
    if (fieldConfig.validation?.isRequired) {
      // For create: field must be present
      // For update: only validate if field is being updated
      const shouldValidate =
        operation === "create" || (operation === "update" && fieldName in data);

      if (
        shouldValidate &&
        (value === undefined || value === null || value === "")
      ) {
        errors.push(`${fieldName} is required`);
      }
    }

    // Check text field length constraints
    if (fieldConfig.type === "text" && value !== undefined && value !== null) {
      const length = fieldConfig.validation?.length;
      if (length) {
        if (length.min !== undefined && value.length < length.min) {
          errors.push(`${fieldName} must be at least ${length.min} characters`);
        }
        if (length.max !== undefined && value.length > length.max) {
          errors.push(`${fieldName} must be at most ${length.max} characters`);
        }
      }
    }

    // Check integer field constraints
    if (
      fieldConfig.type === "integer" &&
      value !== undefined &&
      value !== null
    ) {
      const validation = fieldConfig.validation;
      if (validation) {
        if (validation.min !== undefined && value < validation.min) {
          errors.push(`${fieldName} must be at least ${validation.min}`);
        }
        if (validation.max !== undefined && value > validation.max) {
          errors.push(`${fieldName} must be at most ${validation.max}`);
        }
      }
    }
  }

  return errors;
}
