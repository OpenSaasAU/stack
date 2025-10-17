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
 * Text field
 */
export function text(options?: Omit<TextField, "type">): TextField {
  return {
    type: "text",
    ...options,
  };
}

/**
 * Integer field
 */
export function integer(options?: Omit<IntegerField, "type">): IntegerField {
  return {
    type: "integer",
    ...options,
  };
}

/**
 * Checkbox (boolean) field
 */
export function checkbox(options?: Omit<CheckboxField, "type">): CheckboxField {
  return {
    type: "checkbox",
    ...options,
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
  };
}

/**
 * Password field (automatically hashed)
 */
export function password(options?: Omit<PasswordField, "type">): PasswordField {
  return {
    type: "password",
    ...options,
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
