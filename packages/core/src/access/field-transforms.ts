import type { OpenSaaSConfig, FieldConfig } from '../config/types.js'
import type { HashedPassword } from '../utils/password.js'

/**
 * Extract the return type of a field's afterOperation hook
 * If the field has an afterOperation hook, infer its return type
 * Otherwise, use the original type
 */
export type InferFieldReadType<TField extends FieldConfig, TOriginal> = TField extends {
  hooks?: { afterOperation?: (...args: any[]) => infer R }
}
  ? R extends never
    ? TOriginal // No hook defined
    : R // Hook return type
  : TOriginal // No hooks at all

/**
 * Transform a Prisma model's field types based on OpenSaaS field configs
 * This applies afterOperation hook transformations to field types
 */
export type TransformModelFields<
  TModel extends Record<string, any>,
  TFields extends Record<string, FieldConfig>,
> = {
  [K in keyof TModel]: K extends keyof TFields
    ? InferFieldReadType<TFields[K], TModel[K]>
    : TModel[K]
}

/**
 * Get the field configs for a specific list from the OpenSaaS config
 */
export type GetListFields<
  TConfig extends OpenSaaSConfig,
  TListKey extends keyof TConfig['lists'],
> = TConfig['lists'][TListKey]['fields']

/**
 * Transform a Prisma model result based on OpenSaaS config
 * Applies field hooks transformations
 */
export type TransformResult<
  TConfig extends OpenSaaSConfig,
  TListKey extends keyof TConfig['lists'],
  TResult,
> =
  TResult extends Record<string, any>
    ? TransformModelFields<TResult, GetListFields<TConfig, TListKey>>
    : TResult

/**
 * Transform a Prisma operation's return type
 * Handles single results, arrays, and null cases
 */
export type TransformOperationResult<
  TConfig extends OpenSaaSConfig,
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
