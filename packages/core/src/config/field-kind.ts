import type { ContractFieldDescriptor, FieldConfig, OpenSaasConfig } from './types.js'

/**
 * The `kind` of a field's contract descriptor, or `undefined` when it
 * declares none or refuses to describe itself.
 *
 * `getContractField` is a field's own refusal seam — `embedding()` throws out
 * of it for an impossible `dimensions` or a mismatched `opclass`. A throw is
 * swallowed here rather than left to surface through a call site that did not
 * ask about it: every caller of this module either re-reads the descriptor at
 * a step designed to name the failure (`validateConfigFields`,
 * `readDescriptor` in the CLI's type generator), or only needs a yes/no
 * answer for which "no" is the safe default.
 */
export function readContractDescriptorKind(
  field: FieldConfig,
  fieldKey: string,
  listKey: string,
  config: OpenSaasConfig,
): ContractFieldDescriptor['kind'] | undefined {
  try {
    return field.getContractField?.(fieldKey, listKey, config)?.kind
  } catch {
    return undefined
  }
}

/**
 * Whether `field` stores nothing: the `virtual` flag core's `virtual()` sets,
 * the `'virtual'` type discriminator, or a `{ kind: 'computed' }` contract
 * descriptor. A third-party field can declare the descriptor without the
 * flag — the descriptor is the source of truth, and the flag is a shortcut
 * that answers without invoking `getContractField` at all for the field
 * shape core's own builder produces.
 *
 * This is the one predicate every caller that needs this answer shares —
 * `validateFieldConfig`, the List member resolver's descriptor read, Field
 * Visibility's virtual-field pass, and the CLI's contract-remainder and
 * `needs` rendering (issue #1531).
 *
 * Pass `alreadyRead` when the caller already read the field's descriptor for
 * another reason (the CLI reads it once per field to also render `columns`,
 * `validateFieldConfig` reads it once to also check for `kind: 'columns'`) —
 * that skips a second, possibly-throwing call to `getContractField` for the
 * same field, even when the pre-read `kind` came back `undefined` (no
 * descriptor, or a throw): the caller already has its answer, and
 * re-deriving it would re-invoke a `getContractField` that may throw again.
 * It is wrapped in an object, rather than passed bare, specifically so that
 * case is expressible — a bare `descriptorKind?: Kind | undefined` parameter
 * cannot distinguish "the caller read `undefined`" from "the caller read
 * nothing at all", because a JS default parameter fires on `undefined`
 * regardless of whether it was passed explicitly or omitted; the wrapper
 * object is `undefined` only when truly omitted. Omit `alreadyRead`, and
 * `listKey`/`config` with it, when there is nothing to read:
 * `field.virtual`/`field.type` still answer for any field core's own
 * builders produce, which is what lets a caller with neither (a narrow unit
 * test exercising field access in isolation) still get a correct answer for
 * the common case.
 */
export function isComputedField(
  field: FieldConfig,
  fieldKey: string,
  listKey: string | undefined,
  config: OpenSaasConfig | undefined,
  alreadyRead?: { kind: ContractFieldDescriptor['kind'] | undefined },
): boolean {
  if (field.virtual === true || field.type === 'virtual') return true
  if (alreadyRead !== undefined) return alreadyRead.kind === 'computed'
  if (listKey === undefined || config === undefined) return false
  return readContractDescriptorKind(field, fieldKey, listKey, config) === 'computed'
}
