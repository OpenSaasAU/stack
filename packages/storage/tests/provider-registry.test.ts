import { describe, it, expect, beforeEach } from 'vitest'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import {
  createStorageProvider,
  registerStorageProvider,
  getStorageProviderFactory,
  hasStorageProvider,
  resetStorageProviderRegistry,
} from '../src/runtime/index.js'
import { LocalStorageProvider } from '../src/providers/local.js'
import { assembleImageMetadata, keystoneImageColumnMap } from '../src/utils/multi-column.js'
import type {
  StorageProvider,
  UploadOptions,
  UploadResult,
  BaseStorageConfig,
} from '../src/config/types.js'

/**
 * A minimal custom provider config + implementation used to prove that a
 * non-`local`, host-registered provider can be constructed via the registry —
 * without `@opensaas/stack-storage` depending on `-s3`/`-vercel`.
 */
interface FakeStorageConfig extends BaseStorageConfig {
  type: 'fake'
  baseUrl: string
}

class FakeStorageProvider implements StorageProvider {
  constructor(public readonly config: FakeStorageConfig) {}

  async upload(
    _file: Buffer | Uint8Array,
    filename: string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    return {
      filename,
      url: `${this.config.baseUrl}/${filename}`,
      size: 0,
      contentType: options?.contentType ?? 'application/octet-stream',
    }
  }

  async download(): Promise<Buffer> {
    return Buffer.from('')
  }

  async delete(): Promise<void> {}

  getUrl(filename: string): string {
    return `${this.config.baseUrl}/${filename}`
  }
}

/** Builds a minimal, strongly-typed config carrying a single storage provider. */
function configWith(name: string, providerConfig: BaseStorageConfig): OpenSaasConfig {
  return {
    db: { provider: 'sqlite' },
    lists: {},
    storage: { [name]: providerConfig },
  }
}

describe('storage provider registry', () => {
  beforeEach(() => {
    // Restore registry to built-in defaults so registrations don't leak.
    resetStorageProviderRegistry()
  })

  describe('built-in defaults', () => {
    it("registers 'local' by default so createStorageProvider builds it", () => {
      const config = configWith('files', {
        type: 'local',
        uploadDir: './uploads',
        serveUrl: '/uploads',
      })

      const provider = createStorageProvider(config, 'files')

      expect(provider).toBeInstanceOf(LocalStorageProvider)
    })

    it("reports 'local' as registered", () => {
      expect(hasStorageProvider('local')).toBe(true)
      expect(getStorageProviderFactory('local')).toBeTypeOf('function')
    })
  })

  describe('registering a custom provider', () => {
    it('lets createStorageProvider construct a registered non-local provider', () => {
      registerStorageProvider<FakeStorageConfig>(
        'fake',
        (providerConfig) => new FakeStorageProvider(providerConfig),
      )

      const config = configWith('cdn', {
        type: 'fake',
        baseUrl: 'https://cdn.example.com',
      })

      const provider = createStorageProvider(config, 'cdn')

      expect(provider).toBeInstanceOf(FakeStorageProvider)
      expect(provider.getUrl('photo.jpg')).toBe('https://cdn.example.com/photo.jpg')
    })

    it('passes the provider config through to the factory', () => {
      let received: FakeStorageConfig | undefined
      registerStorageProvider<FakeStorageConfig>('fake', (providerConfig) => {
        received = providerConfig
        return new FakeStorageProvider(providerConfig)
      })

      const providerConfig: FakeStorageConfig = {
        type: 'fake',
        baseUrl: 'https://assets.example.com',
      }

      createStorageProvider(configWith('assets', providerConfig), 'assets')

      expect(received).toEqual(providerConfig)
    })

    it('reflects registration via hasStorageProvider/getStorageProviderFactory', () => {
      expect(hasStorageProvider('fake')).toBe(false)

      registerStorageProvider<FakeStorageConfig>(
        'fake',
        (providerConfig) => new FakeStorageProvider(providerConfig),
      )

      expect(hasStorageProvider('fake')).toBe(true)
      expect(getStorageProviderFactory('fake')).toBeTypeOf('function')
    })

    it('overwrites a previous registration for the same type', () => {
      registerStorageProvider<FakeStorageConfig>(
        'fake',
        (providerConfig) => new FakeStorageProvider({ ...providerConfig, baseUrl: 'first' }),
      )
      registerStorageProvider<FakeStorageConfig>(
        'fake',
        (providerConfig) => new FakeStorageProvider({ ...providerConfig, baseUrl: 'second' }),
      )

      const provider = createStorageProvider(
        configWith('cdn', { type: 'fake', baseUrl: 'ignored' }),
        'cdn',
      )

      expect(provider.getUrl('x')).toBe('second/x')
    })
  })

  describe('unregistered providers', () => {
    it('throws a clear error for an unregistered type', () => {
      const config = configWith('cdn', { type: 's3', bucket: 'my-bucket' })

      expect(() => createStorageProvider(config, 'cdn')).toThrow(
        /Unknown storage provider type: s3/,
      )
      expect(() => createStorageProvider(config, 'cdn')).toThrow(/registerStorageProvider/)
    })

    it('still throws when the named provider is absent from config', () => {
      const config = configWith('files', {
        type: 'local',
        uploadDir: './uploads',
        serveUrl: '/uploads',
      })

      expect(() => createStorageProvider(config, 'missing')).toThrow(
        /Storage provider 'missing' not found in config/,
      )
    })
  })

  describe('read path is unaffected by the registry', () => {
    it('assembleImageMetadata stamps the provider name without constructing a provider', () => {
      // No provider registered for 'remote'; the read path must not care.
      expect(hasStorageProvider('remote')).toBe(false)

      const map = keystoneImageColumnMap('image')
      const row = {
        image_url: 'https://cdn.example.com/pic.jpg',
        image_width: 800,
        image_height: 600,
        image_filesize: 1234,
        image_contentType: 'image/jpeg',
        image_pathname: 'pic.jpg',
      }

      const meta = assembleImageMetadata(row, map, 'remote')

      expect(meta).not.toBeNull()
      expect(meta?.storageProvider).toBe('remote')
      expect(meta?.url).toBe('https://cdn.example.com/pic.jpg')
    })
  })
})
