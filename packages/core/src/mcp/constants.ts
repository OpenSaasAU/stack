/**
 * How many levels deep the `query` tool's `fields` projection schema
 * enumerates a list's relations: the root list's own fields (level 1), and
 * for each relation, the related list's own scalar/virtual fields (level 2).
 * A relation named at level 2 is not itself selectable further — reaching
 * past it is a second tool call, the same round-trip a bare read already
 * assumes. Deliberately shallower than `READ_INCLUDE_MAX_DEPTH` (5) so no
 * schema-conforming request can reach the engine's depth refusal.
 *
 * Fixed (not configurable) by design (ADR-0033, ADR-0026's position on the
 * depth cap) — `generateFieldsProjectionSchema` and `resolveFieldsProjection`
 * (`projection.ts`) are hand-written for exactly this depth (one loop over
 * the root list's fields, one nested loop over a relation's), not driven by
 * this value at runtime. It exists so the depth has one documented, tested
 * name rather than an unexplained "2" in two places; changing it is a
 * deliberate rewrite of both functions, not a config knob.
 */
export const MCP_FIELDS_SCHEMA_DEPTH = 2

/** Row cap applied to a nested to-many relation in a `fields` projection when the caller omits `take`. */
export const MCP_NESTED_TAKE_DEFAULT = 5

/** Hard ceiling a nested to-many relation's `take` is clamped to, regardless of what the caller requests. */
export const MCP_NESTED_TAKE_MAX = 50
