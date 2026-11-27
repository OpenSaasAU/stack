import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ImageMetadata } from '@opensaas/stack-core/internal'
import { ImageField } from '../../src/components/fields/ImageField.js'

vi.mock('next/image.js', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}))

const stored: ImageMetadata = {
  filename: 'abc-cat.png',
  originalFilename: 'cat.png',
  url: 'https://cdn.example.com/abc-cat.png',
  mimeType: 'image/png',
  size: 2048,
  uploadedAt: '2026-01-01T00:00:00.000Z',
  storageProvider: 'local',
  width: 640,
  height: 480,
}

const withThumb: ImageMetadata = {
  ...stored,
  transformations: {
    thumb: { url: 'https://cdn.example.com/abc-cat-thumb.png', width: 64, height: 48, size: 100 },
  },
}

const png = () => new File(['png-bytes'], 'dog.png', { type: 'image/png' })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ImageField', () => {
  describe('edit mode, empty', () => {
    it('accepts images only on its labelled input', () => {
      render(<ImageField name="photo" label="Photo" value={null} onChange={vi.fn()} />)

      const input = screen.getByLabelText('Photo')
      expect(input).toHaveAttribute('type', 'file')
      expect(input).toHaveAttribute('accept', 'image/*')
      expect(screen.getByText('Choose an image or drag and drop')).toBeInTheDocument()
    })

    it('hands a chosen image to onChange and previews it', async () => {
      const onChange = vi.fn()
      const image = png()

      function Harness() {
        const [value, setValue] = React.useState<File | ImageMetadata | null>(null)
        return (
          <ImageField
            name="photo"
            label="Photo"
            value={value}
            onChange={(next) => {
              onChange(next)
              setValue(next)
            }}
          />
        )
      }
      render(<Harness />)

      await userEvent.upload(screen.getByLabelText('Photo'), image)

      expect(onChange).toHaveBeenCalledWith(image)
      const preview = await screen.findByRole('img', { name: 'Preview' })
      expect(preview.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
      expect(screen.getByText(/dog\.png • 9 Bytes • Will upload on save/)).toBeInTheDocument()
    })

    it('ignores a file that is not an image', () => {
      const onChange = vi.fn()
      render(<ImageField name="photo" label="Photo" value={null} onChange={onChange} />)

      fireEvent.change(screen.getByLabelText('Photo'), {
        target: { files: [new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' })] },
      })

      expect(onChange).not.toHaveBeenCalled()
    })

    it('hands the first dropped image to onChange', () => {
      const onChange = vi.fn()
      const image = png()
      render(<ImageField name="photo" label="Photo" value={null} onChange={onChange} />)

      const dropZone = screen.getByText('Choose an image or drag and drop').closest('div.relative')!
      fireEvent.dragOver(dropZone)
      expect(dropZone).toHaveClass('border-primary')
      fireEvent.drop(dropZone, { dataTransfer: { files: [image] } })

      expect(onChange).toHaveBeenCalledWith(image)
      expect(dropZone).not.toHaveClass('border-primary')
    })

    it('ignores a drop while disabled', () => {
      const onChange = vi.fn()
      render(<ImageField name="photo" label="Photo" value={null} onChange={onChange} disabled />)

      const dropZone = screen.getByText('Choose an image or drag and drop').closest('div.relative')!
      fireEvent.drop(dropZone, { dataTransfer: { files: [png()] } })

      expect(onChange).not.toHaveBeenCalled()
    })

    it('reads no preview when showPreview is off', async () => {
      const readAsDataURL = vi.spyOn(FileReader.prototype, 'readAsDataURL')
      const onChange = vi.fn()
      render(
        <ImageField
          name="photo"
          label="Photo"
          value={null}
          onChange={onChange}
          showPreview={false}
        />,
      )

      await userEvent.upload(screen.getByLabelText('Photo'), png())

      expect(onChange).toHaveBeenCalled()
      expect(readAsDataURL).not.toHaveBeenCalled()
    })

    it('describes the input with its help text and error', () => {
      render(
        <ImageField
          name="photo"
          label="Photo"
          value={null}
          onChange={vi.fn()}
          helpText="Square works best"
          error="An image is required"
        />,
      )

      const input = screen.getByLabelText('Photo')
      expect(input).toHaveAccessibleDescription(expect.stringContaining('Square works best'))
      expect(input).toHaveAccessibleDescription(expect.stringContaining('An image is required'))
    })
  })

  describe('edit mode, holding a stored image', () => {
    it('shows the image with its dimensions and size', () => {
      render(<ImageField name="photo" label="Photo" value={stored} onChange={vi.fn()} />)

      expect(screen.getByRole('img', { name: 'cat.png' })).toHaveAttribute('src', stored.url)
      expect(screen.getByText(/cat\.png • 640 ×\s*480px • 2 KB/)).toBeInTheDocument()
    })

    it('opens the image and each transformation in a new tab', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      render(<ImageField name="photo" label="Photo" value={withThumb} onChange={vi.fn()} />)

      await userEvent.click(screen.getByRole('button', { name: 'View Photo' }))
      expect(open).toHaveBeenLastCalledWith(stored.url, '_blank', 'noopener,noreferrer')

      await userEvent.click(screen.getByRole('button', { name: 'thumb (64×48)' }))
      expect(open).toHaveBeenLastCalledWith(
        'https://cdn.example.com/abc-cat-thumb.png',
        '_blank',
        'noopener,noreferrer',
      )
    })

    it('replaces the image through the labelled input', async () => {
      const onChange = vi.fn()
      const image = png()
      render(<ImageField name="photo" label="Photo" value={stored} onChange={onChange} />)

      const replace = screen.getByLabelText('Photo')
      expect(replace).toHaveAttribute('accept', 'image/*')
      await userEvent.upload(replace, image)

      expect(onChange).toHaveBeenCalledWith(image)
    })

    it('clears the value on Remove', async () => {
      const onChange = vi.fn()
      render(<ImageField name="photo" label="Photo" value={stored} onChange={onChange} />)

      await userEvent.click(screen.getByRole('button', { name: 'Remove Photo' }))

      expect(onChange).toHaveBeenCalledWith(null)
    })

    it('drops the preview once the chosen image is removed', async () => {
      function Harness() {
        const [value, setValue] = React.useState<File | ImageMetadata | null>(null)
        return <ImageField name="photo" label="Photo" value={value} onChange={setValue} />
      }
      render(<Harness />)

      await userEvent.upload(screen.getByLabelText('Photo'), png())
      await screen.findByRole('img', { name: 'Preview' })

      await userEvent.click(screen.getByRole('button', { name: 'Remove Photo' }))

      await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument())
      expect(screen.getByText('Choose an image or drag and drop')).toBeInTheDocument()
    })

    it('disables Replace and Remove while disabled', () => {
      render(<ImageField name="photo" label="Photo" value={stored} onChange={vi.fn()} disabled />)

      expect(screen.getByLabelText('Photo')).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Remove Photo' })).toBeDisabled()
    })
  })

  describe('read mode', () => {
    it('says when no image is stored', () => {
      render(<ImageField name="photo" label="Photo" value={null} onChange={vi.fn()} mode="read" />)

      expect(screen.getByText('No image uploaded')).toBeInTheDocument()
    })

    it('shows the stored image, its dimensions and transformations, with no controls', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      render(
        <ImageField name="photo" label="Photo" value={withThumb} onChange={vi.fn()} mode="read" />,
      )

      expect(screen.getByRole('img', { name: 'cat.png' })).toHaveAttribute('src', stored.url)
      expect(screen.getByText(/640 ×\s*480px •\s*2 KB/)).toBeInTheDocument()
      expect(screen.queryByLabelText('Photo')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Remove Photo' })).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'thumb (64×48)' }))
      expect(open).toHaveBeenCalledWith(
        'https://cdn.example.com/abc-cat-thumb.png',
        '_blank',
        'noopener,noreferrer',
      )
    })
  })
})

describe('ImageField shows what its value holds', () => {
  it('shows a picked image without a preview when showPreview is off', () => {
    render(
      <ImageField
        name="photo"
        label="Photo"
        value={png()}
        onChange={vi.fn()}
        showPreview={false}
      />,
    )

    expect(screen.getByText(/dog\.png • 9 Bytes • Will upload on save/)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Photo' })).toBeInTheDocument()
    expect(screen.queryByText('Choose an image or drag and drop')).not.toBeInTheDocument()
  })

  it('shows an image already waiting to upload when it mounts', async () => {
    render(<ImageField name="photo" label="Photo" value={png()} onChange={vi.fn()} />)

    expect(screen.getByText(/dog\.png • 9 Bytes • Will upload on save/)).toBeInTheDocument()
    const preview = await screen.findByRole('img', { name: 'Preview' })
    expect(preview.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
  })

  it('drops the preview when the value is reset to empty from outside', async () => {
    const { rerender } = render(
      <ImageField name="photo" label="Photo" value={null} onChange={vi.fn()} />,
    )
    await userEvent.upload(screen.getByLabelText('Photo'), png())
    rerender(<ImageField name="photo" label="Photo" value={png()} onChange={vi.fn()} />)
    await screen.findByRole('img', { name: 'Preview' })

    rerender(<ImageField name="photo" label="Photo" value={null} onChange={vi.fn()} />)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Choose an image or drag and drop')).toBeInTheDocument()
  })

  it('swaps to the stored image once the value becomes one', async () => {
    const { rerender } = render(
      <ImageField name="photo" label="Photo" value={png()} onChange={vi.fn()} />,
    )
    await screen.findByRole('img', { name: 'Preview' })

    rerender(<ImageField name="photo" label="Photo" value={stored} onChange={vi.fn()} />)

    expect(screen.getByRole('img', { name: 'cat.png' })).toHaveAttribute('src', stored.url)
    expect(screen.queryByRole('img', { name: 'Preview' })).not.toBeInTheDocument()
  })
})
