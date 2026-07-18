/**
 * Per-part `classNames` slots shared by `ItemCreateForm` and `ItemEditForm`
 * (issue #709). Each slot merges onto its `data-slot` part via
 * `cn`/tailwind-merge so caller classes win. The forms apply the spec's section
 * rhythm: a `space-y-6` fields section and a bordered actions footer.
 */
export interface ItemFormClassNames {
  /** The `<form>` root (`data-slot="item-create-form"` / `"item-edit-form"`). */
  root?: string
  /** The general (form-level) error banner (`data-slot="form-error"`). */
  error?: string
  /** The fields section (`data-slot="form-fields"`). */
  fields?: string
  /** The actions footer (`data-slot="form-actions"`). */
  actions?: string
  /** The submit button (`data-slot="button"`). */
  submit?: string
  /** The cancel button (`data-slot="button"`). */
  cancel?: string
}
