import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { uploadImage } from '../src/runtime/index.js'

function crc32(buf: Buffer): number {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function pngDeclaring(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.alloc(1))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const config = {
  storage: { local: { type: 'local', uploadDir: './unused', serveUrl: '/f' } },
} as unknown as OpenSaasConfig

describe('uploadImage pixel cap', () => {
  it('refuses an oversized canvas before any transformation runs', async () => {
    const buffer = pngDeclaring(16000, 16000)
    const file = new File([new Uint8Array(buffer)], 'big.png', { type: 'image/png' })
    await expect(
      uploadImage(config, 'local', { file, buffer }, { transformations: { t: { width: 10 } } }),
    ).rejects.toThrow(/exceed the maximum of 50000000 pixels/)
  })

  it('refuses an oversized canvas even with no transformations', async () => {
    const buffer = pngDeclaring(16000, 16000)
    const file = new File([new Uint8Array(buffer)], 'big.png', { type: 'image/png' })
    await expect(uploadImage(config, 'local', { file, buffer })).rejects.toThrow(
      /exceed the maximum/,
    )
  })

  it('honours a custom maxPixels', async () => {
    const buffer = pngDeclaring(100, 100)
    const file = new File([new Uint8Array(buffer)], 'a.png', { type: 'image/png' })
    await expect(
      uploadImage(
        config,
        'local',
        { file, buffer },
        { validation: { maxPixels: 5000 }, transformations: { t: { width: 10 } } },
      ),
    ).rejects.toThrow(/exceed the maximum of 5000 pixels/)
  })
})
