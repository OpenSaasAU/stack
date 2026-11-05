import { beforeEach, describe, expect, it, vi } from 'vitest'
import { put } from '@vercel/blob'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { registerStorageProvider, uploadFile } from '@opensaas/stack-storage/runtime'
import {
  VercelBlobStorageProvider,
  vercelBlobStorage,
  type VercelBlobStorageConfig,
} from '../src/index.js'

vi.mock('@vercel/blob', () => ({
  put: vi.fn().mockResolvedValue({ url: 'u', downloadUrl: 'd', pathname: 'p' }),
  del: vi.fn().mockResolvedValue(undefined),
  get: vi.fn(),
  issueSignedToken: vi.fn(),
  presignUrl: vi.fn(),
  BlobNotFoundError: class extends Error {},
}))

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  storage: { docs: vercelBlobStorage({ token: 'vercel_blob_rw_store1_secret' }) },
  lists: {},
}

async function multipart(declared: string): Promise<File> {
  const boundary = 'opensaas-test-boundary'
  const formData = await new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.pdf"\r\nContent-Type: ${declared}\r\n\r\n<script>alert(1)</script>\r\n--${boundary}--\r\n`,
  }).formData()
  const file = formData.get('file')
  if (!(file instanceof File)) throw new Error('the multipart body carried no file')
  return file
}

beforeEach(() => {
  registerStorageProvider<VercelBlobStorageConfig>(
    'vercel-blob',
    (c) => new VercelBlobStorageProvider(c),
  )
  vi.mocked(put).mockClear()
})

describe('VercelBlobStorageProvider never receives a raw declared type (issue #2148)', () => {
  it.each(['text/html x', 'text/html,x', 'image/svg+xml x', 'TEXT/HTML x'])(
    'puts %j as an octet-stream .bin blob',
    async (declared) => {
      const file = await multipart(declared)

      await uploadFile(config, 'docs', { file, buffer: Buffer.from(await file.arrayBuffer()) })

      expect(put).toHaveBeenCalledWith(
        expect.stringMatching(/\.bin$/),
        expect.anything(),
        expect.objectContaining({ contentType: 'application/octet-stream' }),
      )
    },
  )

  it('puts a parameterised type under its bare essence', async () => {
    const file = await multipart('APPLICATION/PDF; name="text/html"')

    await uploadFile(config, 'docs', { file, buffer: Buffer.from(await file.arrayBuffer()) })

    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(/\.pdf$/),
      expect.anything(),
      expect.objectContaining({ contentType: 'application/pdf' }),
    )
  })
})
