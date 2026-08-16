import type { OpenSaasConfig, FieldConfig } from '../config/types.js'
import type { HashedPassword } from '../utils/password.js'

export type InferFieldReadType<TField extends FieldConfig, TOriginal> = TField extends {
  // Uses `any` here so TypeScript's conditional type inference can pick up the
  // exact return type `R` from a hook of any signature.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hooks?: { afterOperation?: (...args: any[]) => infer R }
}
  ? R extends never
    ? TOriginal
    : R
  : TOriginal

export type TransformModelFields<
  // Uses `any` so this constraint accepts Prisma's generated model types, which are
  // indexed by string keys.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TModel extends Record<string, any>,
  TFields extends Record<string, FieldConfig>,
> = {
  [K in keyof TModel]: K extends keyof TFields
    ? InferFieldReadType<TFields[K], TModel[K]>
    : TModel[K]
}

export type GetListFields<
  TConfig extends OpenSaasConfig,
  TListKey extends keyof TConfig['lists'],
> = TConfig['lists'][TListKey]['fields']

export type TransformResult<
  TConfig extends OpenSaasConfig,
  TListKey extends keyof TConfig['lists'],
  TResult,
> =
  // Uses `any` to check whether TResult is an object type that can be transformed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TResult extends Record<string, any>
    ? TransformModelFields<TResult, GetListFields<TConfig, TListKey>>
    : TResult

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

export interface FieldTypeTransforms {
  password: HashedPassword
}

export type InferFieldTypeTransform<TField extends FieldConfig> = TField extends {
  type: infer TType
}
  ? TType extends keyof FieldTypeTransforms
    ? FieldTypeTransforms[TType]
    : never
  : never
