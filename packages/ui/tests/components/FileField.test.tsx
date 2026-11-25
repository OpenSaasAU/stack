import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FileMetadata } from '@opensaas/stack-core/internal'
import { FileField } from '../../src/components/fields/FileField.js'

const stored: FileMetadata = {
  filename: 'abc-report.pdf',
  originalFilename: 'report.pdf',
  url: 'https://cdn.example.com/abc-report.pdf',
  mimeType: 'application/pdf',
  size: 1536,
  uploadedAt: '2026-01-01T00:00:00.000Z',
  storageProvider: 'local',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FileField', () => {
  describe('edit mode, empty', () => {
    it('labels the file input and shows the placeholder', () => {
      render(<FileField name="doc" label="Document" value={null} onChange={vi.fn()} />)

      const input = screen.getByLabelText('Document')
      expect(input).toHaveAttribute('type', 'file')
      expect(screen.getByText('Choose a file or drag and drop')).toBeInTheDocument()
    })

    it('names the input by its placeholder when there is no label', () => {
      render(<FileField name="doc" value={null} onChange={vi.fn()} placeholder="Attach" />)

      expect(screen.getByLabelText('Attach')).toHaveAttribute('type', 'file')
    })

    it('hands a chosen file to onChange', async () => {
      const onChange = vi.fn()
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
      render(<FileField name="doc" label="Document" value={null} onChange={onChange} />)

      await userEvent.upload(screen.getByLabelText('Document'), file)

      expect(onChange).toHaveBeenCalledWith(file)
    })

    it('hands the first dropped file to onChange', () => {
      const onChange = vi.fn()
      const first = new File(['a'], 'a.txt')
      const second = new File(['b'], 'b.txt')
      render(<FileField name="doc" label="Document" value={null} onChange={onChange} />)

      const dropZone = screen.getByText('Choose a file or drag and drop').closest('div.relative')!
      fireEvent.drop(dropZone, { dataTransfer: { files: [first, second] } })

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith(first)
    })

    it('marks the drop zone while a file is dragged over it', () => {
      render(<FileField name="doc" label="Document" value={null} onChange={vi.fn()} />)

      const dropZone = screen.getByText('Choose a file or drag and drop').closest('div.relative')!
      fireEvent.dragOver(dropZone)
      expect(dropZone).toHaveClass('border-primary')

      fireEvent.dragLeave(dropZone)
      expect(dropZone).not.toHaveClass('border-primary')
    })

    it('ignores a drop while disabled', () => {
      const onChange = vi.fn()
      render(<FileField name="doc" label="Document" value={null} onChange={onChange} disabled />)

      const dropZone = screen.getByText('Choose a file or drag and drop').closest('div.relative')!
      fireEvent.drop(dropZone, { dataTransfer: { files: [new File(['a'], 'a.txt')] } })

      expect(onChange).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Document')).toBeDisabled()
    })

    it('describes the input with its help text and error', () => {
      render(
        <FileField
          name="doc"
          label="Document"
          value={null}
          onChange={vi.fn()}
          helpText="PDF only"
          error="A file is required"
        />,
      )

      const input = screen.getByLabelText('Document')
      expect(input).toHaveAccessibleDescription(expect.stringContaining('PDF only'))
      expect(input).toHaveAccessibleDescription(expect.stringContaining('A file is required'))
      expect(input).toHaveAttribute('aria-invalid', 'true')
    })
  })

  describe('edit mode, holding a file', () => {
    it('shows a chosen file as pending upload', () => {
      const file = new File(['x'.repeat(2048)], 'notes.txt')
      render(<FileField name="doc" label="Document" value={file} onChange={vi.fn()} />)

      expect(screen.getByText('notes.txt')).toBeInTheDocument()
      expect(screen.getByText('2 KB • Will upload on save')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'View' })).not.toBeInTheDocument()
    })

    it('shows a stored file with its type and opens it on View', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      render(<FileField name="doc" label="Document" value={stored} onChange={vi.fn()} />)

      expect(screen.getByText('report.pdf')).toBeInTheDocument()
      expect(screen.getByText('1.5 KB • application/pdf')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'View' }))
      expect(open).toHaveBeenCalledWith(stored.url, '_blank', 'noopener,noreferrer')
    })

    it('keeps the label on the replace input', async () => {
      const onChange = vi.fn()
      const next = new File(['n'], 'next.txt')
      render(<FileField name="doc" label="Document" value={stored} onChange={onChange} />)

      await userEvent.upload(screen.getByLabelText('Document'), next)

      expect(onChange).toHaveBeenCalledWith(next)
    })

    it('clears the value on Remove', async () => {
      const onChange = vi.fn()
      render(<FileField name="doc" label="Document" value={stored} onChange={onChange} />)

      await userEvent.click(screen.getByRole('button', { name: 'Remove Document' }))

      expect(onChange).toHaveBeenCalledWith(null)
    })

    it('disables Replace and Remove while disabled', () => {
      render(<FileField name="doc" label="Document" value={stored} onChange={vi.fn()} disabled />)

      expect(screen.getByLabelText('Document')).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Remove Document' })).toBeDisabled()
    })
  })

  describe('read mode', () => {
    it('says when no file is stored', () => {
      render(<FileField name="doc" label="Document" value={null} onChange={vi.fn()} mode="read" />)

      expect(screen.getByText('No file uploaded')).toBeInTheDocument()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('shows the stored file and downloads it', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      render(
        <FileField name="doc" label="Document" value={stored} onChange={vi.fn()} mode="read" />,
      )

      expect(screen.getByText('report.pdf')).toBeInTheDocument()
      expect(screen.getByText('1.5 KB')).toBeInTheDocument()
      expect(screen.queryByLabelText('Document')).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Download' }))
      expect(open).toHaveBeenCalledWith(stored.url, '_blank', 'noopener,noreferrer')
    })

    it('formats an empty file as 0 Bytes', () => {
      render(
        <FileField
          name="doc"
          label="Document"
          value={{ ...stored, size: 0 }}
          onChange={vi.fn()}
          mode="read"
        />,
      )

      expect(screen.getByText('0 Bytes')).toBeInTheDocument()
    })
  })
})
