import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DatasetIntakeStatus } from '../shared/dataset'
import {
  DatasetIntake,
  isFileUploadBlocked,
  isPublicUrlBlocked,
  LOCAL_ONLY_COPY,
  UPLOAD_CSV_COPY,
  USE_PUBLIC_CSV_URL_COPY,
} from './DatasetIntake'

const ready: DatasetIntakeStatus = { convex: true, uploadThing: true, sampleAvailable: true }
const uploadThingDown: DatasetIntakeStatus = { convex: true, uploadThing: false, sampleAvailable: true }
const storageDown: DatasetIntakeStatus = { convex: false, uploadThing: false, sampleAvailable: true }

describe('DatasetIntake gates', () => {
  it('always accepts a file, and blocks links when either storage service is unavailable', () => {
    expect(isFileUploadBlocked(ready)).toBe(false)
    expect(isPublicUrlBlocked(ready)).toBe(false)
    // A file is charted in the browser, so it needs no service.
    expect(isFileUploadBlocked(uploadThingDown)).toBe(false)
    expect(isFileUploadBlocked(storageDown)).toBe(false)
    // A link is fetched by the server.
    expect(isPublicUrlBlocked(uploadThingDown)).toBe(true)
    expect(isPublicUrlBlocked(storageDown)).toBe(true)
    expect(isFileUploadBlocked(uploadThingDown, true)).toBe(true)
    expect(isPublicUrlBlocked(uploadThingDown, true)).toBe(true)
  })

  it('keeps file upload open and explains local reading when storage is unavailable', () => {
    const onSubmitUrl = vi.fn()
    render(
      <DatasetIntake
        status={uploadThingDown}
        onUploadFile={vi.fn()}
        onSubmitUrl={onSubmitUrl}
      />,
    )
    expect(document.querySelector('.intake-card')).not.toHaveClass('is-disabled')
    expect(screen.getByLabelText(UPLOAD_CSV_COPY)).toBeEnabled()
    expect(screen.getByRole('button', { name: UPLOAD_CSV_COPY })).toBeEnabled()
    expect(screen.getByLabelText(/public https csv url/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: USE_PUBLIC_CSV_URL_COPY })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/public https csv url/i), {
      target: { value: 'https://jev-gamecast.vercel.app/samples/nyc-squirrel-census.csv' },
    })
    fireEvent.click(screen.getByRole('button', { name: USE_PUBLIC_CSV_URL_COPY }))
    expect(onSubmitUrl).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent(LOCAL_ONLY_COPY)
    expect(screen.queryByText(/datasets and results are public/i)).not.toBeInTheDocument()
  })

  it('accepts a dropped file', () => {
    const onUploadFile = vi.fn()
    render(<DatasetIntake status={storageDown} onUploadFile={onUploadFile} onSubmitUrl={vi.fn()} />)
    const file = new File(['a,b\n1,2\n'], 'drop.csv', { type: 'text/csv' })
    fireEvent.drop(document.querySelector('.byod-file')!, { dataTransfer: { files: [file] } })
    expect(onUploadFile).toHaveBeenCalledWith(file)
  })

  it('disables the URL field when durable storage is down', () => {
    render(
      <DatasetIntake
        status={storageDown}
        onUploadFile={vi.fn()}
        onSubmitUrl={vi.fn()}
      />,
    )
    expect(document.querySelector('.intake-card')).not.toHaveClass('is-disabled')
    expect(screen.getByRole('button', { name: UPLOAD_CSV_COPY })).toBeEnabled()
    expect(screen.getByRole('button', { name: USE_PUBLIC_CSV_URL_COPY })).toBeDisabled()
  })
})
