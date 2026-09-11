import type { ListConfig } from '../config/types.js'
import type { StackContext } from './index.js'
import {
  executeResolveInput,
  executeValidate,
  executeFieldResolveInputHooks,
  executeFieldValidateHooks,
  validateFieldRules,
  splitMultiColumnFields,
  ValidationError,
} from '../hooks/index.js'
import { applyCreateDefaults } from './apply-defaults.js'

/**
 * The transform+validate span of a write. See the "Hook Pipeline" and "Write
 * Pipeline" glossary terms in CONTEXT.md for the full phase order and the
 * boundary with the Write Pipeline (which owns side-effect hooks, access,
 * writable-field filtering, nested operations, persistence, Field Visibility).
 */

export interface HookPipelineArgs {
  operation: 'create' | 'update'
  listName: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>
  inputData: Record<string, unknown>
  item: Record<string, unknown> | undefined
  // #1176: the full secured context (sudo/withSession/transaction), bound to
  // the write's transaction client — see `bindContextToTransaction`.
  context: StackContext
}

export interface HookPipelineResult {
  resolvedData: Record<string, unknown>
}

export interface HookPipeline {
  run(args: HookPipelineArgs): Promise<HookPipelineResult>
}

async function runHookPipeline(args: HookPipelineArgs): Promise<HookPipelineResult> {
  const { operation, listName, listConfig, inputData, item, context } = args

  let resolvedData = await executeResolveInput(
    listConfig.hooks,
    operation === 'create'
      ? {
          listKey: listName,
          operation: 'create',
          inputData,
          resolvedData: inputData,
          item: undefined,
          context,
        }
      : {
          listKey: listName,
          operation: 'update',
          inputData,
          resolvedData: inputData,
          item,
          context,
        },
  )

  resolvedData = await executeFieldResolveInputHooks(
    inputData,
    resolvedData,
    listConfig.fields,
    operation,
    context,
    listName,
    item,
  )

  // Must run after resolveInput hooks and before validation, so a
  // required-with-default field passes `isRequired` on an omitted input
  // instead of failing it (see applyCreateDefaults, issue #615).
  if (operation === 'create') {
    resolvedData = applyCreateDefaults(resolvedData, listConfig.fields)
  }

  await executeValidate(
    listConfig.hooks,
    operation === 'create'
      ? {
          listKey: listName,
          operation: 'create',
          inputData,
          resolvedData,
          item: undefined,
          context,
        }
      : {
          listKey: listName,
          operation: 'update',
          inputData,
          resolvedData,
          item,
          context,
        },
  )

  await executeFieldValidateHooks(
    inputData,
    resolvedData,
    listConfig.fields,
    operation,
    context,
    listName,
    item,
  )

  // Unlike an access-denied `context.db` operation, a validation failure
  // throws rather than returning null/[] — validation is never silent.
  const validation = validateFieldRules(resolvedData, listConfig.fields, operation)
  if (validation.errors.length > 0) {
    throw new ValidationError(validation.errors, validation.fieldErrors)
  }

  // Runs only once the logical value has passed validation above (#789) — a
  // multi-column field validated after splitting could see an unrecognised
  // value silently become null/undefined columns instead of throwing.
  resolvedData = await splitMultiColumnFields(
    inputData,
    resolvedData,
    listConfig.fields,
    operation,
    context,
    item,
  )

  return { resolvedData }
}

export const hookPipeline: HookPipeline = {
  run: runHookPipeline,
}
