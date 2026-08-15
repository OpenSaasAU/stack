# A field may serialise differently from its TypeScript type

Status: accepted

A field type's **TypeScript type** and its **wire representation** are separate contracts, and a field may deliberately differ between them. The TypeScript type is chosen for correctness in application code; the wire representation is chosen for what the transport can carry. Where they differ, the field owns the conversion at the boundary, states it in its documentation, and covers it with a regression test at that boundary.

## Context

Field types are self-contained: a builder supplies `getZodSchema`, `getPrismaType` and `getTypeScriptType`, and generators and UI delegate to it rather than switching on the type. That contract has an unstated assumption — that the value described by `getTypeScriptType()` is the value every consumer receives. Two shipped transports break it:

- The MCP request handler serialises CRUD tool results with `JSON.stringify`.
- The admin UI passes values fetched in server components into `"use client"` children, across the RSC serializer.

Neither is total. `JSON.stringify` throws outright on a `bigint`, and the two transports do not agree with each other: React's Flight serializer and `JSON.stringify` support different value sets, so "serialisable" is not one predicate.

`decimal()` reached this first and left it unresolved rather than deciding it. Its `getTypeScriptType()` returns `import('decimal.js').Decimal` — an object type that `JSON.stringify` renders lossily and that carries no meaning to an MCP client. The question never became urgent because `decimal` has no registered admin UI component, so it renders as nothing and never crosses the RSC boundary; and its `Decimal` object stringifies to *something* rather than throwing. The gap was survivable by accident, in a way that would not have held for the next such field.

Triage of #907 (a `bigInt()` field whose TypeScript type is `bigint`) forced the decision, because `bigint` fails loudly where `Decimal` failed quietly: a single `bigInt` value in a returned row makes the MCP tool throw. A field type that crashes a shipped feature on read is not shippable, so the relationship between the two contracts had to be stated rather than assumed.

## Considered options

- **Let the two contracts differ, with the field owning the conversion (chosen).** The TypeScript type stays the correct one and each transport gets a representation it can carry. Costs an asymmetry a reader can be surprised by, which is why it must be documented at the field and tested at the boundary.
- **Constrain field types to JSON-serialisable values.** Rejected: it bans `bigint` and would retroactively ban `decimal`'s `Decimal`, pushing precision-sensitive values back to `number` or `string`. A 64-bit integer typed as a string is `text()` with extra steps — the type would stop describing the value, which is a worse and more permanent loss than an asymmetry at one boundary.
- **Convert at every boundary uniformly, regardless of the field.** Rejected: it assumes one serialisability predicate, and there is not one. `JSON.stringify` and the RSC serializer disagree, so a uniform rule either over-converts on the transport that did not need it — adding dead weight and a second representation to reason about — or under-converts on the one that did.
- **Keep the type honest and let unsupported transports fail.** Rejected: it makes a field's usability depend on which features an application has enabled, and the failure surfaces as a runtime throw in MCP rather than as anything a config author could anticipate.

## Consequences

- **A field's documentation must state its wire representation where it differs from its TypeScript type.** For `bigInt`, that is: `bigint` in application code, a decimal string in MCP output. An undocumented asymmetry is indistinguishable from a bug.
- **The difference is a tested boundary, not a convention.** A field that converts at a transport carries a regression test at that transport. For `bigInt` and MCP the test is not optional: the unconverted behaviour is an uncaught `TypeError`, so the test is what distinguishes "handled" from "not yet hit".
- **Serialisability is established per transport, by observation.** Because the transports disagree, a new field crossing a boundary determines what that specific boundary does with the value rather than reasoning from another boundary's behaviour. #907 applies this to the RSC case explicitly: verify whether React's Flight serializer handles `bigint` on the repo's actual React version, and add a conversion only if it does not. A pre-emptive conversion is as much a defect as a missing one, because it is untestable dead weight that outlives the reason it was added.
- **`decimal()` is now inconsistent with this ADR and is not retrofitted here.** Its `Decimal` output has no stated wire representation and no boundary test, and it has no registered admin UI component, so it renders as nothing. That is pre-existing and is called out so the gap is recorded rather than mistaken for a decision. Retrofitting it is a separate change, and it will need one if it ever gains a UI component.
- **This does not license per-transport representations proliferating.** The rule is that a field may differ from its TypeScript type where the transport cannot carry it — not that a field may present a different shape wherever convenient. Two representations are the ceiling a field should reach for: the typed value, and a serialised form. A third is a sign the type is wrong.
