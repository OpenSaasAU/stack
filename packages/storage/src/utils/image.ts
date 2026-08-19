import sharp from 'sharp'
import type {
  ImageTransformationConfig,
  ImageTransformationResult,
  StorageProvider,
} from '../config/types.js'

export async function getImageDimensions(
  buffer: Buffer | Uint8Array,
): Promise<{ width: number; height: number }> {
  const metadata = await sharp(buffer).metadata()
  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
  }
}

export async function transformImage(
  buffer: Buffer | Uint8Array,
  transformation: ImageTransformationConfig,
): Promise<Buffer> {
  let image = sharp(buffer)

  if (transformation.width || transformation.height) {
    image = image.resize({
      width: transformation.width,
      height: transformation.height,
      fit: transformation.fit || 'cover',
    })
  }

  if (transformation.format) {
    const options = {
      quality: transformation.quality || 80,
    }

    switch (transformation.format) {
      case 'jpeg':
        image = image.jpeg(options)
        break
      case 'png':
        image = image.png(options)
        break
      case 'webp':
        image = image.webp(options)
        break
      case 'avif':
        image = image.avif(options)
        break
    }
  }

  return await image.toBuffer()
}

export async function processImageTransformations(
  buffer: Buffer | Uint8Array,
  originalFilename: string,
  transformations: Record<string, ImageTransformationConfig>,
  storageProvider: StorageProvider,
  contentType: string,
): Promise<Record<string, ImageTransformationResult>> {
  const results: Record<string, ImageTransformationResult> = {}

  for (const [name, config] of Object.entries(transformations)) {
    const transformedBuffer = await transformImage(buffer, config)

    const { width, height } = await getImageDimensions(transformedBuffer)

    const ext = config.format ? `.${config.format}` : ''
    const transformedFilename = `${originalFilename}-${name}${ext}`

    const uploadResult = await storageProvider.upload(transformedBuffer, transformedFilename, {
      contentType:
        config.format === 'jpeg'
          ? 'image/jpeg'
          : config.format === 'png'
            ? 'image/png'
            : config.format === 'webp'
              ? 'image/webp'
              : config.format === 'avif'
                ? 'image/avif'
                : contentType,
    })

    results[name] = {
      url: uploadResult.url,
      width,
      height,
      size: uploadResult.size,
    }
  }

  return results
}
