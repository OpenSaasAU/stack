// Issue #1625: `acceptedMimeTypes` used to be checked against the
// CLIENT-DECLARED type, and every provider stored the object under the
// client's own extension. An `.html` file declared `application/pdf` passed
// a PDF-only field and was served same-origin as `text/html` — stored XSS.
//
// These tests drive the real `uploadFile`/`uploadImage` runtime functions
// (not a field or a mocked upload surface) against a fake provider that
// records exactly what it was asked to store, so the effective-type rule is
// verified end to end: validation, the stored extension, and the content
// type handed to the provider.
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import {
  uploadFile,
  uploadImage,
  registerStorageProvider,
  resetStorageProviderRegistry,
} from '../src/runtime/index.js'
import { localStorage } from '../src/config/index.js'
import { LocalStorageProvider } from '../src/providers/local.js'
import type {
  StorageProvider,
  UploadOptions,
  UploadResult,
  BaseStorageConfig,
} from '../src/config/types.js'

interface FakeStorageConfig extends BaseStorageConfig {
  type: 'fake'
}

const uploads: { filename: string; contentType: string | undefined }[] = []

class FakeStorageProvider implements StorageProvider {
  constructor(public readonly config: FakeStorageConfig) {}

  async upload(
    _file: Buffer | Uint8Array,
    filename: string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    uploads.push({ filename, contentType: options?.contentType })
    return {
      filename,
      url: `/fake/${filename}`,
      size: 0,
      contentType: options?.contentType ?? 'application/octet-stream',
    }
  }

  async download(): Promise<Buffer> {
    return Buffer.from('')
  }

  async delete(): Promise<void> {}

  getUrl(filename: string): string {
    return `/fake/${filename}`
  }
}

const config = {
  storage: { fake: { type: 'fake' } as FakeStorageConfig },
} as unknown as OpenSaasConfig

beforeEach(() => {
  resetStorageProviderRegistry()
  registerStorageProvider('fake', (c) => new FakeStorageProvider(c as FakeStorageConfig))
  uploads.length = 0
})

/** A 1x1 PNG — real bytes, so sharp reports its actual detected format. */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xff, 0xff, 0x3f,
  0x03, 0x00, 0x08, 0xfc, 0x02, 0xfe, 0xa7, 0x35, 0x81, 0x84, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

const SVG_WITH_SCRIPT = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
)

function makeFile(name: string, type: string, bytes: Uint8Array | string = 'x'): File {
  const body = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes)
  return new File([body], name, { type })
}

describe('uploadFile: effective MIME type drives storage, never the client extension', () => {
  it('stores an .html upload declared application/pdf under .pdf, with the declared type as mimeType', async () => {
    const file = makeFile('x.html', 'application/pdf', '<script>alert(document.cookie)</script>')
    const metadata = await uploadFile(
      config,
      'fake',
      { file, buffer: Buffer.from(await file.arrayBuffer()) },
      { validation: { acceptedMimeTypes: ['application/pdf'] } },
    )

    expect(metadata.mimeType).toBe('application/pdf')
    expect(metadata.originalFilename).toBe('x.html')
    expect(metadata.filename.endsWith('.pdf')).toBe(true)
    expect(metadata.filename.endsWith('.html')).toBe(false)
    expect(uploads).toEqual([
      { filename: expect.stringMatching(/\.pdf$/), contentType: 'application/pdf' },
    ])
  })

  it('refuses text/html with no validation config at all, and writes nothing to the provider', async () => {
    const file = makeFile('x.html', 'text/html', '<script>alert(1)</script>')
    await expect(
      uploadFile(config, 'fake', { file, buffer: Buffer.from(await file.arrayBuffer()) }),
    ).rejects.toThrow(/active content/)
    expect(uploads).toEqual([])
  })

  it('refuses an undeclared .html upload (type resolved from the filename) with no validation config', async () => {
    const file = makeFile('x.html', '', '<script>alert(1)</script>')
    await expect(
      uploadFile(config, 'fake', { file, buffer: Buffer.from(await file.arrayBuffer()) }),
    ).rejects.toThrow(/active content/)
    expect(uploads).toEqual([])
  })

  it('accepts text/html once acceptedMimeTypes names it explicitly', async () => {
    const file = makeFile('x.html', 'text/html', '<p>hello</p>')
    const metadata = await uploadFile(
      config,
      'fake',
      { file, buffer: Buffer.from(await file.arrayBuffer()) },
      { validation: { acceptedMimeTypes: ['text/html'] } },
    )
    expect(metadata.mimeType).toBe('text/html')
    expect(metadata.filename.endsWith('.html')).toBe(true)
  })
})

describe('uploadImage: the effective type is the bytes sharp decodes, never the declared type', () => {
  it('refuses an SVG with a <script> element by default', async () => {
    const file = makeFile('x.svg', 'image/svg+xml', SVG_WITH_SCRIPT)
    await expect(
      uploadImage(config, 'fake', { file, buffer: Buffer.from(await file.arrayBuffer()) }),
    ).rejects.toThrow(/active content/)
    expect(uploads).toEqual([])
  })

  it('accepts the same SVG once acceptedMimeTypes includes image/svg+xml', async () => {
    const file = makeFile('x.svg', 'image/svg+xml', SVG_WITH_SCRIPT)
    const metadata = await uploadImage(
      config,
      'fake',
      { file, buffer: Buffer.from(await file.arrayBuffer()) },
      { validation: { acceptedMimeTypes: ['image/svg+xml'] } },
    )
    expect(metadata.mimeType).toBe('image/svg+xml')
    expect(metadata.filename.endsWith('.svg')).toBe(true)
  })

  it('stores real PNG bytes declared as image/jpeg under .png / image/png (the sniffed type wins)', async () => {
    const file = makeFile('photo.jpg', 'image/jpeg', PNG_BYTES)
    const metadata = await uploadImage(config, 'fake', {
      file,
      buffer: Buffer.from(await file.arrayBuffer()),
    })

    expect(metadata.mimeType).toBe('image/png')
    expect(metadata.filename.endsWith('.png')).toBe(true)
    expect(uploads).toEqual([
      { filename: expect.stringMatching(/\.png$/), contentType: 'image/png' },
    ])
  })

  it('refuses non-image bytes declared as image/png', async () => {
    const file = makeFile('x.png', 'image/png', 'this is not an image, just plain text bytes')
    await expect(
      uploadImage(config, 'fake', { file, buffer: Buffer.from(await file.arrayBuffer()) }),
    ).rejects.toThrow(/not a recognized image/)
    expect(uploads).toEqual([])
  })
})

describe('LocalStorageProvider: the file actually lands on disk under the effective extension', () => {
  let uploadDir: string
  let localConfig: OpenSaasConfig

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'opensaas-storage-mime-test-'))
    localConfig = {
      storage: { files: localStorage({ uploadDir, serveUrl: '/uploads' }) },
    } as unknown as OpenSaasConfig
  })

  afterAll(async () => {
    await rm(uploadDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    registerStorageProvider('local', (c) => new LocalStorageProvider(c as never))
  })

  it('writes an .html-declared-application/pdf upload to disk as a real .pdf file', async () => {
    const file = makeFile('x.html', 'application/pdf', '<script>alert(document.cookie)</script>')
    const metadata = await uploadFile(
      localConfig,
      'files',
      { file, buffer: Buffer.from(await file.arrayBuffer()) },
      { validation: { acceptedMimeTypes: ['application/pdf'] } },
    )

    expect(metadata.filename.endsWith('.pdf')).toBe(true)
    // The file that actually exists on disk carries the corrected extension —
    // this is what closes the same-origin-serving XSS: Next resolves the
    // response type from THIS extension, not the client's original name.
    const onDisk = join(uploadDir, metadata.filename)
    await expect(rm(onDisk)).resolves.toBeUndefined()
  })
})
