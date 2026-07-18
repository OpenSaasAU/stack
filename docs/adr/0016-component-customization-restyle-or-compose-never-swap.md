# Component customization: restyle or compose, never swap

The admin UI must let developers change component design without forking the package. We decided the customization ladder is: theme tokens → `className`/`classNames` slot props (tailwind-merge) → stable `data-slot` attributes targetable from plain CSS → composition (build pages from `/standalone`, `/fields`, `/primitives`, or replace field widgets via the existing field-component registry). We explicitly **rejected** a global primitive registry (`registerPrimitive('Button', …)`) that would swap component implementations inside the prebuilt `AdminUI`.

## Considered Options

A primitive registry mirroring the field registry was the obvious symmetric design. Rejected because its only unique capability — globally swapping _behaviour_, not style — is a support liability (every bug report becomes suspect), it forces indirection and weaker types at every internal use site, and composition already covers "genuinely different component" honestly at the page level.

## Consequences

- `data-slot` attribute names are a public compatibility promise, kept stable across releases, and work without any app-level Tailwind pipeline (apps often consume only the package's precompiled CSS).
- Arbitrary utility classes passed via `className` props require the app to run its own Tailwind entry scanning its source — documented as the opt-in "customizing" setup.
- The answer to "can I swap the Button inside `AdminUI`?" is deliberately **no**: restyle it, or compose your own pages.
