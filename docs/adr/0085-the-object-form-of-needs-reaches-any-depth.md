# The object form of `needs` reaches any depth

Status: accepted

[ADR-0051](0051-declared-dependencies-are-an-emitted-one-hop-set.md) made `needs` one hop and deferred ADR-0025's object form for want of a consumer. [#2497](https://github.com/OpenSaasAU/stack/issues/2497) is one: a production app on 0.43 whose display names chain `Attendance → Enrolment → { Student, ClassTerm → { Class, Term } }`. ADR-0051's answer, a privileged read in the hook, is at least one query per row and moves the access decision out of the declaration. One of that app's views went from 119 to 263 queries as rows grew.

**The array form is unchanged and stays one hop. The object form reaches exactly as deep as it is written.**

```ts
needs: { enrolment: { student: true, classTerm: ['class', 'term'] } }
```

## The grammar

Each key is a stored column, a relationship field or a synthetic back-relation (`from_<List>_<field>`) of the list at that level.

- A column takes `true`. Without this the object form could not name a column beside a relation, and a row reached by a nested object would carry no columns of its own.
- A relation takes `true` for its rows' stored columns, or an array or nested object for exactly what is named beneath it.
- Every level also carries its list's system fields and the foreign key of each relation it names.
- A computed field is refused at every depth, as are an unknown name and a value its key does not take. The refusal names the list, the field and the path.

A synthetic back-relation is accepted in the array form too.

## It is spelled out, so it cannot cycle

No computed field runs on a declared branch, so nothing on one declares anything. `Post → comments → post` ends where the object ends. There is no closure, no guard and no depth cap; `READ_INCLUDE_MAX_DEPTH` still bounds the caller's tree alone.

## It is fetched with the read

The emitted table gains `nested` beneath a relation, and the include plan nests it, so the hops travel as nested includes of the read that computes the field. A plain include of the same relation carries them too, withheld from that level's own rules and hooks. A relation the caller shaped is fetched apart from the caller's view, as one hop already was: one batched read for each such relation at each level, per 10,000 rows.

## Access

Every hop carries the target list's `query` access, so a row the session cannot see is `null` or absent, and nothing is reached through it (ADR-0058).

**A declaration outranks a field-level `read` denial at every depth.** That includes the source field's rule gating a synthetic back-relation. Depth widens the channel ADR-0051 recorded: a declaration can now name a read-denied column on a list several hops away. It is still explicit and greppable, and still owned by whoever wrote it. The caller's own view is unaffected: a caller-named relation the session is denied is replaced by the declared branch and stripped, never reduced or counted.

**A `read` rule still sees one hop.** ADR-0082 denies a rule reaching for a relation the row does not carry. Rows beneath a declared relation can now carry relations, and a scoped-away `null` there would read as "no row". The guard therefore withholds every relation of a related row, and enumeration leaves them out.

**A hook's item is cut to its own declaration at every depth.** Two fields naming the same relation to different depths share one fetch, and neither sees the other's reach. The row objects are copies, so assigning a key on one no longer reaches a later access decision; a JSON value inside a row is still shared. A multi-column field is assembled under its own key, as the types already claimed.

## Types

An object-form declaration renders as `NeedsBranchRow`, so reading an undeclared column at any depth is a compile error in a hook typed through `Lists.<List>.TypeInfo`. Every to-one hop is `| null`. The array form keeps `NeedsRow`.

## The upgrade warns

In 0.43 an array-form `needs` folded through the related list's own declarations. On this line it silently stops at one hop, so `pnpm generate` warns when a relation it names reaches a list with a computed field that needs relations of its own. The message names both fields and the object form that spells the chain out. It is a warning because one hop is often what is meant; `{ relation: true }` says so and silences it.

## Considered Options

- **Dotted paths**: rejected by ADR-0025, and they repeat the shared prefix of every branch.
- **Fold through the related list's `needs` again**: rejected. It is the transitive closure ADR-0051 removed, with its cycle guard, and it makes a field's inputs depend on another list's fields.
- **A nested object carries the whole stored row**: rejected. It leaves nothing for "undeclared" to mean at that level.
- **Teach the read-rule guard scoped-away hops at depth**: rejected. It would let a rule depend on what some computed field happened to declare.

## Consequences

- ADR-0051's one-hop rule holds for the array form only, and its "no known consumer" premise no longer holds.
- A deep declaration on a list pays its nested fetch on every read that returns the field and on every write (ADR-0081). It fetches each hop at full stored width.
- 0.43.x is not changed.
