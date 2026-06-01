import type { ListConfig } from '../config/types.js'
import type { AccessContext } from '../access/types.js'
import {
  executeResolveInput,
  executeValidate,
  executeFieldResolveInputHooks,
  executeFieldValidateHooks,
  validateFieldRules,
  ValidationError,
} from '../hooks/index.js'

/**
 * Hook Pipeline — the single module that runs the transform+validate span of a
 * write: list `resolveInput` → field `resolveInput` → list `validate` → field
 * `validate` → built-in field rules (`validateFieldRules`). It owns the order of
 * these phases and the threading of `resolvedData` through them, in one place.
 *
 * It is THE place where input is shaped and validated; it throws
 * {@link ValidationError} on failure exactly as before (validate hooks via
 * `addValidationError`, then `validateFieldRules`) — validation is never silent.
 *
 * Side-effect hooks (`beforeOperation`/`afterOperation`), operation-level access,
 * writable-field filtering, nested operations, persistence and Field Visibility
 * are deliberately OUT of this span — they stay in the Write Pipeline. See the
 * "Hook Pipeline" and "Write Pipeline" glossary terms in CONTEXT.md.
 */

/**
 * Arguments for one transform+validate span. Only the create/update operations
 * run this span (delete skips the input-shaping phases entirely).
 */
export interface HookPipelineArgs {
  operation: 'create' | 'update'
  listName: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>
  /** The original input data for the write. */
  inputData: Record<string, unknown>
  /** The existing row for update; `undefined` for create. */
  item: Record<string, unknown> | undefined
  context: AccessContext
}

/**
 * Result of a transform+validate span: the fully-resolved write data after the
 * resolveInput hooks have run and all validation has passed.
 */
export interface HookPipelineResult {
  resolvedData: Record<string, unknown>
}

/**
 * The transform+validate span, owning order + `resolvedData` threading.
 */
export interface HookPipeline {
  run(args: HookPipelineArgs): Promise<HookPipelineResult>
}

/**
 * Run the transform+validate span once.
 *
 * Phase order (owned here, in one place):
 *   list `resolveInput`
 *     → field `resolveInput`
 *     → list `validate`
 *     → field `validate`
 *     → built-in field rules (`validateFieldRules`)
 *
 * Contract preserved exactly:
 *   - `resolvedData` starts as `inputData` and is threaded through each phase;
 *   - validate hooks report failures via `addValidationError` → THROW
 *     `ValidationError` (never silent);
 *   - built-in field rule failures THROW `ValidationError`;
 *   - on success returns the transformed `resolvedData`.
 */
async function runHookPipeline(args: HookPipelineArgs): Promise<HookPipelineResult> {
  const { operation, listName, listConfig, inputData, item, context } = args

  // ── Phase 1: list-level resolveInput ──────────────────────────────────────
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

  // ── Phase 1.5: field-level resolveInput (e.g. hash passwords) ──────────────
  resolvedData = await executeFieldResolveInputHooks(
    inputData,
    resolvedData,
    listConfig.fields,
    operation,
    context,
    listName,
    item,
  )

  // ── Phase 2: list-level validate ──────────────────────────────────────────
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

  // ── Phase 2.5: field-level validate ───────────────────────────────────────
  await executeFieldValidateHooks(
    inputData,
    resolvedData,
    listConfig.fields,
    operation,
    context,
    listName,
    item,
  )

  // ── Phase 3: built-in field rules (isRequired, length, etc.) ──────────────
  // Validation failures THROW (validation is not silent).
  const validation = validateFieldRules(resolvedData, listConfig.fields, operation)
  if (validation.errors.length > 0) {
    throw new ValidationError(validation.errors, validation.fieldErrors)
  }

  return { resolvedData }
}

/**
 * The default Hook Pipeline instance used by the Write Pipeline.
 */
export const hookPipeline: HookPipeline = {
  run: runHookPipeline,
}
