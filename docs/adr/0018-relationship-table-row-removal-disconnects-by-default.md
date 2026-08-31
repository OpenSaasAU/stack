# Relationship-table row removal disconnects by default

The edit view renders to-many relationships as inline-editable tables of the related list's rows, and each row has a remove control. The approved design mock (Users → Orders) shows removal _deleting_ the order, but a generic admin UI cannot know whether a related row is an owned child (delete is right) or a shared reference like a tag (delete would destroy data other items still use). We chose the non-destructive default: remove disconnects the relationship, and true deletion is an explicit per-relationship opt-in (`removeAction: 'delete'`), which then confirms before deleting and is gated on the related list's delete access. Where the schema makes disconnect statically impossible (a required foreign key on the related side), the control is hidden unless delete is opted into.

This is a deliberate deviation from the mock: anyone comparing the built UI to the design will wonder why ✕ doesn't delete — that default was rejected because a generic UI must not default to destruction.

_Amended by ADR-0048: across an explicit junction list there is no disconnect. Removing an edge deletes the junction row, gated on that list's own delete access; the non-destructive principle is unchanged (removing an edge must not destroy an endpoint row), and `removeAction: 'delete'` still means "delete the far endpoint too"._

_Amended by ADR-0050 for the other direction: **adding** an edge across an explicit junction list creates the junction row, gated on that list's own create access. `connect` is refused across a junction, because there it is a second write against a list with its own access rules rather than a foreign-key assignment. Removal and addition are now symmetric._
