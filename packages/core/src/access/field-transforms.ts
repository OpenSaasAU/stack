import type { OpenSaasConfig, FieldConfig } from '../config/types.js'
import type { HashedPassword } from '../utils/password.js'

/**
 * Extract the return type of a field's afterOperation hook
 * If the field has an afterOperation hook, infer its return type
 * Otherwise, use the original type
 */
export type InferFieldReadType<TField extends FieldConfig, TOriginal> = TField extends {
  // Generic `any` is required here for TypeScript's conditional type inference to work correctly
  // This allows us to infer the exact return type `R` from hooks of any signature
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hooks?: { afterOperation?: (...args: any[]) => infer R }
}
  ? R extends never
    ? TOriginal // No hook defined
    : R // Hook return type
  : TOriginal // No hooks at all

/**
 * Transform a Prisma model's field types based on OpenSaas field configs
 * This applies afterOperation hook transformations to field types
 */
export type TransformModelFields<
  // Generic constraint requires `any` to allow indexing by string keys from Prisma models
  // This is necessary for mapped types to work with Prisma's generated model types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TModel extends Record<string, any>,
  TFields extends Record<string, FieldConfig>,
> = {
  [K in keyof TModel]: K extends keyof TFields
    ? InferFieldReadType<TFields[K], TModel[K]>
    : TModel[K]
}

/**
 * Get the field configs for a specific list from the OpenSaas config
 */
export type GetListFields<
  TConfig extends OpenSaasConfig,
  TListKey extends keyof TConfig['lists'],
> = TConfig['lists'][TListKey]['fields']

/**
 * Transform a Prisma model result based on OpenSaas config
 * Applies field hooks transformations
 */
export type TransformResult<
  TConfig extends OpenSaasConfig,
  TListKey extends keyof TConfig['lists'],
  TResult,
> =
  // Generic constraint requires `any` to check if TResult is an object type that can be transformed
  // This pattern is standard in TypeScript for conditional types on object shapes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TResult extends Record<string, any>
    ? TransformModelFields<TResult, GetListFields<TConfig, TListKey>>
    : TResult

/**
 * Transform a Prisma operation's return type
 * Handles single results, arrays, and null cases
 */
export type TransformOperationResult<
  TConfig extends OpenSaasConfig,
  TListKey extends keyof TConfig['lists'],
  TResult,
> =
  TResult extends Promise<infer R>
    ? Promise<
        R extends Array<infer Item>
          ? Array<TransformResult<TConfig, TListKey, Item>>
          : R extends null
            ? null
            : TransformResult<TConfig, TListKey, R>
      >
    : never

/**
 * Known field type mappings for afterOperation hooks
 * These provide concrete type hints for common field transformations
 */
export interface FieldTypeTransforms {
  password: HashedPassword
  // Future field types can be added here
  // richText: TiptapContent
  // json: JSONValue
}

/**
 * Helper to infer field type based on field config type
 */
export type InferFieldTypeTransform<TField extends FieldConfig> = TField extends {
  type: infer TType
}
  ? TType extends keyof FieldTypeTransforms
    ? FieldTypeTransforms[TType]
    : never
  : never
