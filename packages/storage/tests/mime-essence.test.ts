// Issue #2148: the active-content check and the stored extension must read the
// same type. Uploads here arrive through `Request.formData()`, because undici
// hands a multipart part's Content-Type through nearly verbatim where
// `new File()` would blank part of this input.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { localStorage } from '../src/config/index.js'
import { file as fileField } from '../src/fields/index.js'
import { LocalStorageProvider } from '../src/providers/local.js'
import {
  createStorageUtils,
  parseFileFromFormData,
  uploadFile,
  uploadImage,
} from '../src/runtime/index.js'
import {
  extensionForMimeType,
  isActiveMimeType,
  resolveEffectiveMimeType,
  validateFile,
  type FileValidationOptions,
} from '../src/utils/upload.js'

const BOOT = 120_000
const OCTET_STREAM = 'application/octet-stream'
const BOUNDARY = 'opensaas-test-boundary'
const STRICT_ESSENCE = /^[a-z0-9!#$%&'*+.^_`|~-]+\/[a-z0-9!#$%&'*+.^_`|~-]+$/
const ACTIVE_EXTENSION = /\.(html?|xhtml|xht|svg|svgz|xml|xsl|xslt|js|mjs|ecma)$/i

const HTML = '<script>alert(document.cookie)</script>'

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xff, 0xff, 0x3f,
  0x03, 0x00, 0x08, 0xfc, 0x02, 0xfe, 0xa7, 0x35, 0x81, 0x84, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

async function multipart(
  declared: string,
  filename = 'x.pdf',
  content: string | Uint8Array = HTML,
): Promise<{ file: File; buffer: Buffer }> {
  const body = Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${declared}\r\n\r\n`,
      'latin1',
    ),
    Buffer.from(content),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`, 'latin1'),
  ])
  const formData = await new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    body,
  }).formData()
  const parsed = await parseFileFromFormData(formData)
  if (parsed === null) throw new Error('the multipart body carried no file')
  return parsed
}

const MALFORMED = [
  'text/html x',
  'text/html,x',
  'image/svg+xml x',
  'application/xhtml+xml x',
  'TEXT/HTML x',
  'text/html x; charset=utf-8',
  'text/html,text/plain',
  'text/plain,text/html',
  '"text/html"',
  'text/html"',
  'text/html/x',
  'text /html',
  'text/ html',
  'text/',
  '/html',
  'html',
  '/',
]

const JAVASCRIPT_ESSENCES = [
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
]

const REFUSED = [
  'text/html',
  'TEXT/HTML',
  'Text/Html; charset=utf-8',
  'text/html ;x',
  'text/html;;;x',
  'text/html;x="a;b"',
  '  text/html  ',
  'image/svg+xml; a="b"',
  'application/vnd.example+xml',
  'APPLICATION/VND.EXAMPLE+XML',
  'text/xsl',
  'unknown/unknown',
  'application/unknown',
  '*/*',
  ...JAVASCRIPT_ESSENCES,
]

describe('declared MIME types through Request.formData() (issue #2148)', () => {
  let uploadDir: string
  let config: OpenSaasConfig

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'opensaas-storage-essence-test-'))
    config = {
      db: { provider: 'postgresql' },
      storage: { files: localStorage({ uploadDir, serveUrl: '/uploads' }) },
      lists: {},
    }
  })

  afterAll(async () => {
    await rm(uploadDir, { recursive: true, force: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const upload = async (declared: string, filename?: string, validation?: FileValidationOptions) =>
    uploadFile(config, 'files', await multipart(declared, filename), { validation })

  it.each(MALFORMED)('stores %j as an inert octet-stream', async (declared) => {
    const providerUpload = vi.spyOn(LocalStorageProvider.prototype, 'upload')

    const metadata = await upload(declared)

    expect(metadata.mimeType).toBe(OCTET_STREAM)
    expect(metadata.filename).toMatch(/\.bin$/)
    expect(providerUpload).toHaveBeenCalledWith(
      expect.anything(),
      'x.bin',
      expect.objectContaining({ contentType: OCTET_STREAM }),
    )
    expect(await readdir(uploadDir)).toContain(metadata.filename)
  })

  it('takes nothing active from the client name when the declared type is malformed', async () => {
    const metadata = await upload('text/html x', 'invoice.html')
    expect(metadata.mimeType).toBe(OCTET_STREAM)
    expect(metadata.filename).not.toMatch(ACTIVE_EXTENSION)
  })

  it.each(REFUSED)('refuses %j as active content', async (declared) => {
    const providerUpload = vi.spyOn(LocalStorageProvider.prototype, 'upload')

    await expect(upload(declared)).rejects.toThrow(/active content/)

    expect(providerUpload).not.toHaveBeenCalled()
  })

  it.each([
    ['application/pdf', 'application/pdf', '.pdf'],
    ['APPLICATION/PDF', 'application/pdf', '.pdf'],
    ['application/pdf; name="text/html"', 'application/pdf', '.pdf'],
    ['application/pdf ; a=1;; b="c;d"', 'application/pdf', '.pdf'],
    ['image/png;charset=utf-8', 'image/png', '.png'],
  ])('stores %j under its bare essence', async (declared, essence, extension) => {
    const providerUpload = vi.spyOn(LocalStorageProvider.prototype, 'upload')

    const metadata = await upload(declared)

    expect(metadata.mimeType).toBe(essence)
    expect(metadata.mimeType).toMatch(STRICT_ESSENCE)
    expect(metadata.filename.endsWith(extension)).toBe(true)
    expect(providerUpload).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ contentType: essence }),
    )
  })

  it.each(['text/html\tx', 'text/html\u000bx', 'text/html\u0000', 'text/html x'])(
    'a %j the File constructor blanks falls back to the client name',
    async (declared) => {
      const parsed = await multipart(declared)
      expect(parsed.file.type).toBe('')

      const metadata = await uploadFile(config, 'files', parsed)
      expect(metadata.mimeType).toBe('application/pdf')
      expect(metadata.filename.endsWith('.pdf')).toBe(true)

      const html = await multipart(declared, 'x.html')
      await expect(uploadFile(config, 'files', html)).rejects.toThrow(/active content/)
    },
  )

  describe('acceptedMimeTypes', () => {
    it('matches the normalised type, not the raw declared string', async () => {
      const metadata = await upload('TEXT/HTML; charset=utf-8', 'x.html', {
        acceptedMimeTypes: ['text/html'],
      })
      expect(metadata.mimeType).toBe('text/html')
      expect(metadata.filename.endsWith('.html')).toBe(true)
    })

    it.each(['text/html x', 'text/html,x'])(
      'opting in to text/html does not admit %j',
      async (d) => {
        await expect(upload(d, 'x.html', { acceptedMimeTypes: ['text/html'] })).rejects.toThrow(
          /not allowed/,
        )
      },
    )

    it('an entry spelling the raw malformed string matches nothing', async () => {
      await expect(
        upload('text/html x', 'x.html', { acceptedMimeTypes: ['text/html x'] }),
      ).rejects.toThrow(/not allowed/)
    })

    it('stays an explicit opt-in for each newly active essence', async () => {
      const metadata = await upload('application/ecmascript', 'x.es', {
        acceptedMimeTypes: ['application/ecmascript'],
      })
      expect(metadata.mimeType).toBe('application/ecmascript')
    })

    it('admits a malformed type only as the octet-stream it was normalised to', async () => {
      const metadata = await upload('text/html x', 'x.html', {
        acceptedMimeTypes: [OCTET_STREAM],
      })
      expect(metadata.mimeType).toBe(OCTET_STREAM)
      expect(metadata.filename).not.toMatch(ACTIVE_EXTENSION)
    })
  })

  it('acceptedExtensions refuses a malformed type, which has no stored extension to accept', async () => {
    await expect(
      upload('text/html x', 'x.html', { acceptedExtensions: ['.html'] }),
    ).rejects.toThrow(/not allowed/)
  })

  describe('image() still reads the bytes', () => {
    it('stores real PNG bytes under the sniffed type whatever was declared', async () => {
      const metadata = await uploadImage(
        config,
        'files',
        await multipart('text/html x', 'x.html', PNG_BYTES),
      )
      expect(metadata.mimeType).toBe('image/png')
      expect(metadata.filename.endsWith('.png')).toBe(true)
    })

    it('refuses bytes that are not an image, whatever was declared', async () => {
      await expect(
        uploadImage(config, 'files', await multipart('image/png x', 'x.png')),
      ).rejects.toThrow(/not a recognized image/)
    })

    it('refuses an SVG declared with a trailing token', async () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'
      await expect(
        uploadImage(config, 'files', await multipart('image/svg+xml x', 'x.svg', svg)),
      ).rejects.toThrow(/active content/)
    })
  })
})

describe('the issue #2148 repro against a real file() field', () => {
  let uploadDir: string
  let harness: TestContext

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'opensaas-storage-essence-field-test-'))
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      storage: { files: localStorage({ uploadDir, serveUrl: '/uploads' }) },
      lists: {
        Doc: {
          fields: { attachment: fileField({ storage: 'files' }) },
          access: { operation: { query: () => true, create: () => true } },
        },
      },
    }
    harness = await createTestContext(config, null, { storage: createStorageUtils(config) })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
    await rm(uploadDir, { recursive: true, force: true })
  })

  it.each(['text/html x', 'text/html,x', 'image/svg+xml x', 'TEXT/HTML x'])(
    'writes %j to disk under a non-active name',
    async (declared) => {
      const { file } = await multipart(declared)

      await harness.context.db.Doc.create({ data: { attachment: file } })

      const stored = await readdir(uploadDir)
      expect(stored.length).toBeGreaterThan(0)
      expect(stored.filter((name) => ACTIVE_EXTENSION.test(name))).toEqual([])
      expect(stored.filter((name) => !name.endsWith('.bin'))).toEqual([])
    },
  )
})

describe('one parser for every reader of the type', () => {
  const hostile = [
    ...MALFORMED,
    'text/html\tx',
    'text/html\u000bx',
    'text/html\u000cx',
    'text/html\u0000',
    'text/html\u0000x',
    'text/html\u0085x',
    'text/html x',
    ' text/html',
    ' text/html',
    '﻿text/html',
    'text/html x',
    'teKt/html',
    ' ',
    ';',
    '; charset=utf-8',
  ]

  it.each(hostile)('%j is neither stored raw nor given an extension', (type) => {
    expect(resolveEffectiveMimeType({ name: 'x.html', type })).toBe(OCTET_STREAM)
    expect(extensionForMimeType(type)).toBeUndefined()
    expect(isActiveMimeType(type)).toBe(true)
  })

  it.each(hostile)('validateFile lets %j through only as octet-stream', (type) => {
    const accepted = validateFile(
      { size: 1, name: 'x.html', type },
      { acceptedMimeTypes: ['text/html'] },
    )
    expect(accepted.valid).toBe(false)
    expect(accepted.error).toContain(`'${OCTET_STREAM}'`)
  })

  it.each([
    ['\ttext/html\r\n', 'text/html'],
    [' TEXT/HTML ', 'text/html'],
    ['text/html\t;x', 'text/html'],
  ])('strips only HTTP whitespace from %j', (type, essence) => {
    expect(resolveEffectiveMimeType({ name: 'x.pdf', type })).toBe(essence)
    expect(isActiveMimeType(type)).toBe(true)
    expect(extensionForMimeType(type)).toBe('.html')
  })

  it('still looks an undeclared type up from the name', () => {
    expect(resolveEffectiveMimeType({ name: 'x.pdf', type: '' })).toBe('application/pdf')
    expect(resolveEffectiveMimeType({ name: 'noext', type: '' })).toBe(OCTET_STREAM)
  })

  it.each(['application/pdf', 'image/png', 'application/json', 'text/plain', 'text/css'])(
    '%s stays inert',
    (type) => {
      expect(isActiveMimeType(type)).toBe(false)
    },
  )
})
