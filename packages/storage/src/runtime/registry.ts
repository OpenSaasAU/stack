import type { StorageProvider, BaseStorageConfig, LocalStorageConfig } from '../config/types.js'
import { LocalStorageProvider } from '../providers/local.js'

/**
 * A factory that constructs a {@link StorageProvider} from its provider config.
 *
 * The factory is generic over the concrete config shape so a provider package
 * can register with full type safety (e.g. `S3StorageConfig`), while the
 * registry stores factories against the {@link BaseStorageConfig} contract that
 * every provider config satisfies.
 *
 * @typeParam TConfig - The provider-specific config type (must extend
 * {@link BaseStorageConfig}).
 */
export type StorageProviderFactory<TConfig extends BaseStorageConfig = BaseStorageConfig> = (
  config: TConfig,
) => StorageProvider

/**
 * Internal registry mapping a provider `type` to its factory.
 *
 * Factories are stored against {@link BaseStorageConfig} because every provider
 * config extends it. `registerStorageProvider` narrows the public input to the
 * concrete config type, then widens it for storage — this conversion happens
 * once, internally, so the public API stays free of `any`/casts.
 */
const registry = new Map<string, StorageProviderFactory>()

/**
 * Registers a storage provider factory for a given provider `type`.
 *
 * The host application calls this to opt in to a provider it uses — either one
 * of the optional provider packages (`@opensaas/stack-storage-s3`,
 * `@opensaas/stack-storage-vercel`) or a custom provider. Once registered,
 * {@link createStorageProvider} can construct that provider when a field is
 * bound to it.
 *
 * Registering an already-registered `type` overwrites the previous factory,
 * allowing a host to replace a built-in (e.g. swap the default `'local'`
 * provider) if needed.
 *
 * @typeParam TConfig - The provider-specific config type.
 * @param type - The provider `type` discriminator used in storage config
 * (e.g. `'s3'`, `'vercel-blob'`, `'cloudflare-r2'`).
 * @param factory - A function that builds the provider from its config.
 *
 * @example
 * ```typescript
 * import { registerStorageProvider } from '@opensaas/stack-storage/runtime'
 * import { S3StorageProvider, type S3StorageConfig } from '@opensaas/stack-storage-s3'
 *
 * registerStorageProvider<S3StorageConfig>('s3', (config) => new S3StorageProvider(config))
 * ```
 */
export function registerStorageProvider<TConfig extends BaseStorageConfig>(
  type: string,
  factory: StorageProviderFactory<TConfig>,
): void {
  // `factory` accepts a narrower `TConfig`; the registry stores it against the
  // wider `BaseStorageConfig`. This widening wrapper is safe because
  // `createStorageProvider` only ever invokes a factory with the config whose
  // `type` selected it, so the runtime config always matches `TConfig`.
  const widened: StorageProviderFactory = (config) => factory(config as TConfig)
  registry.set(type, widened)
}

/**
 * Returns the factory registered for a provider `type`, or `undefined` when no
 * provider has been registered under that `type`.
 */
export function getStorageProviderFactory(type: string): StorageProviderFactory | undefined {
  return registry.get(type)
}

/**
 * Returns `true` when a provider factory is registered for the given `type`.
 */
export function hasStorageProvider(type: string): boolean {
  return registry.has(type)
}

/**
 * Resets the registry to only the built-in defaults.
 *
 * Primarily useful in tests to guarantee isolation between cases that register
 * custom providers.
 */
export function resetStorageProviderRegistry(): void {
  registry.clear()
  registerBuiltinProviders()
}

/**
 * Registers the providers that ship with `@opensaas/stack-storage` itself.
 *
 * Currently only `'local'`, which keeps existing behaviour unchanged: hosts get
 * local filesystem storage with no registration step. Optional providers
 * (`s3`, `vercel-blob`) are NOT registered here — the host opts into those to
 * avoid forcing the AWS/Vercel SDKs onto every storage user.
 */
function registerBuiltinProviders(): void {
  registerStorageProvider<LocalStorageConfig>('local', (config) => new LocalStorageProvider(config))
}

// Register built-in providers on module load so `'local'` works by default.
registerBuiltinProviders()
