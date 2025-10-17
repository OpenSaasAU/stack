import type { AccessControl, FieldAccess } from "../access/types.js";
import type { z } from "zod";

/**
 * Field configuration types
 */
export type FieldType =
  | "text"
  | "integer"
  | "checkbox"
  | "timestamp"
  | "password"
  | "select"
  | "relationship";

export type BaseFieldConfig = {
  type: FieldType;
  access?: FieldAccess;
  defaultValue?: any;
  ui?: {
    /**
     * Custom React component to render this field
     * Overrides the default component for this field type
     */
    component?: any;
    /**
     * Additional UI-specific configuration
     */
    [key: string]: any;
  };
  /**
   * Generate Zod schema for this field
   * @param fieldName - The name of the field (for error messages)
   * @param operation - Whether this is a create or update operation
   */
  getZodSchema?: (
    fieldName: string,
    operation: "create" | "update",
  ) => z.ZodTypeAny;
};

export type TextField = BaseFieldConfig & {
  type: "text";
  validation?: {
    isRequired?: boolean;
    length?: {
      min?: number;
      max?: number;
    };
  };
  isIndexed?: boolean | "unique";
  ui?: {
    displayMode?: "input" | "textarea";
  };
};

export type IntegerField = BaseFieldConfig & {
  type: "integer";
  validation?: {
    isRequired?: boolean;
    min?: number;
    max?: number;
  };
};

export type CheckboxField = BaseFieldConfig & {
  type: "checkbox";
};

export type TimestampField = BaseFieldConfig & {
  type: "timestamp";
  defaultValue?: { kind: "now" } | Date;
};

export type PasswordField = BaseFieldConfig & {
  type: "password";
  validation?: {
    isRequired?: boolean;
  };
};

export type SelectField = BaseFieldConfig & {
  type: "select";
  options: Array<{ label: string; value: string }>;
  validation?: {
    isRequired?: boolean;
  };
  ui?: {
    displayMode?: "select" | "segmented-control" | "radio";
  };
};

export type RelationshipField = BaseFieldConfig & {
  type: "relationship";
  ref: string; // Format: 'ListName.fieldName'
  many?: boolean;
  ui?: {
    displayMode?: "select" | "cards";
  };
};

export type FieldConfig =
  | TextField
  | IntegerField
  | CheckboxField
  | TimestampField
  | PasswordField
  | SelectField
  | RelationshipField;

/**
 * List configuration types
 */
export type OperationAccess<T = any> = {
  query?: AccessControl<T>;
  create?: AccessControl<T>;
  update?: AccessControl<T>;
  delete?: AccessControl<T>;
};

export type HookArgs<T = any> = {
  operation: "create" | "update" | "delete";
  resolvedData?: Partial<T>;
  item?: T;
  context: any;
};

export type Hooks<T = any> = {
  resolveInput?: (
    args: HookArgs<T> & { operation: "create" | "update" },
  ) => Promise<Partial<T>>;
  validateInput?: (
    args: HookArgs<T> & {
      operation: "create" | "update";
      addValidationError: (msg: string) => void;
    },
  ) => Promise<void>;
  beforeOperation?: (args: HookArgs<T>) => Promise<void>;
  afterOperation?: (args: HookArgs<T>) => Promise<void>;
};

export type ListConfig<T = any> = {
  fields: Record<string, FieldConfig>;
  access?: {
    operation?: OperationAccess<T>;
  };
  hooks?: Hooks<T>;
};

/**
 * Database configuration
 */
export type DatabaseConfig = {
  provider: "postgresql" | "mysql" | "sqlite";
  url: string;
};

/**
 * Session configuration
 */
export type SessionConfig = {
  getSession: () => Promise<any>;
};

/**
 * UI configuration
 */
export type UIConfig = {
  basePath?: string;
};

/**
 * Main configuration type
 */
export type OpenSaaSConfig = {
  db: DatabaseConfig;
  lists: Record<string, ListConfig>;
  session?: SessionConfig;
  ui?: UIConfig;
};
