# Storage providers are constructed via a registration hook, not a hardcoded factory switch

The storage runtime's `createStorageProvider` is a closed `switch` that constructs only `local` and throws for every other `type`. The S3 and Vercel-Blob provider packages exist and implement the provider interface, but nothing can construct them, and there is no way to add a custom provider. We make the runtime resolve a provider's constructor through a **Provider registry** that the host populates, rather than a hardcoded switch.

## Decisions

- **A registration hook, not a switch.** `createStorageProvider` consults a registry that maps a provider `type` to its constructor; the host registers the (optional) provider packages it uses, or a custom provider instance/constructor. The runtime no longer hardcodes which providers exist.
- **Provider packages stay optional dependencies.** `@opensaas/stack-storage` does not depend on `@opensaas/stack-storage-s3` / `-vercel`. Wiring them into the factory directly would force the AWS / Vercel SDKs onto every storage user and bloat every serverless function — the same eager-dependency problem flagged in ADR-0008. The host opts in by registering.
- **Reads never construct a provider.** The multi-column READ path (`assembleImageMetadata`) stamps only the provider *name* (a string), so existing assets render with no provider call. The registration gap therefore only ever affected *uploads* — which is why this corrects, rather than blocks, the "Vercel Blob is first-class" intent of ADR-0006.

## Why this is worth recording

A reader will see a registry where a one-line `switch` would obviously do, and want to "simplify" it back. That regression would re-force every provider's SDK as a hard dependency of `@opensaas/stack-storage` and defeat the optional-provider-package design. Recording the trade-off — an open, host-populated registry versus a closed switch — stops that, and pins down what "supported provider" means: *registerable*, not *built into the factory*.
