// ───────────────────────────────────────────────────────────────
// @opensaas/stack-core/extend
//
// Authoring contracts for extending the stack: implement these when
// you build a plugin or a third-party field package. Stable, public
// API — distinct from the everyday consumer surface on the root entry
// point and from the unstable plumbing on `/internal`.
// ───────────────────────────────────────────────────────────────

// Plugin authoring (see the Plugin System docs)
export type { Plugin, PluginContext, GeneratedFiles, ExtensionDescriptor } from './config/index.js'

// Third-party field authoring (implement BaseFieldConfig; see custom-field docs)
export type {
  BaseFieldConfig,
  TypeInfo,
  TypeDescriptor,
  MultiColumnPrismaResult,
} from './config/index.js'

// Filter spec authoring — a field's optional `getFilterSpec` returns these
// (ADR-0017). Additive: a field without one is simply not filterable.
export type {
  FilterSpec,
  FilterOperator,
  FilterCondition,
  FilterValueSource,
} from './filter/index.js'
