// Browser-safe stub for `next/image`, used only when bundling @opensaas/stack-ui
// for claude.ai/design previews. Renders a plain <img> so ImageField displays
// outside a Next app (no image optimization pipeline).
import * as React from 'react'

type ImageProps = Omit<React.ComponentPropsWithoutRef<'img'>, 'src' | 'width' | 'height'> & {
  src?: string | { src?: string }
  alt?: string
  width?: number | string
  height?: number | string
  fill?: boolean
  priority?: boolean
  quality?: number
  placeholder?: string
  blurDataURL?: string
  sizes?: string
  loader?: unknown
}

const Image = React.forwardRef<HTMLImageElement, ImageProps>(function Image(
  { src, alt, width, height, fill, priority, quality, placeholder, blurDataURL, sizes, loader, ...rest },
  ref,
) {
  const resolved = typeof src === 'string' ? src : (src?.src ?? '')
  return React.createElement('img', { ref, src: resolved, alt: alt ?? '', width, height, ...rest })
})

export default Image
