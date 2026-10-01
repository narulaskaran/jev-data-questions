import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DatasetIntakeStatus } from '../shared/dataset'
import {
  DatasetIntake,
  isFileUploadBlocked,
  isPublicUrlBlocked,
  UPLOAD_CSV_COPY,
  USE_PUBLIC_CSV_URL_COPY,
} from './DatasetIntake'

const ready: DatasetIntakeStatus = { convex: true, uploadThing: true, sampleAvailable: true }
const uploadThingDown: DatasetIntakeStatus = { convex: true, uploadThing: false, sampleAvailable: true }
const storageDown: DatasetIntakeStatus = { convex: false, uploadThing: false, sampleAvailable: true }

describe('DatasetIntake gates', () => {
  it('blocks intake when either storage service is unavailable', () => {
    expect(isFileUploadBlocked(ready)).toBe(false)
    expect(isPublicUrlBlocked(ready)).toBe(false)
    expect(isFileUploadBlocked(uploadThingDown)).toBe(true)
    expect(isPublicUrlBlocked(uploadThingDown)).toBe(true)
    expect(isFileUploadBlocked(storageDown)).toBe(true)
    expect(isPublicUrlBlocked(storageDown)).toBe(true)
    expect(isFileUploadBlocked(uploadThingDown, true)).toBe(true)
    expect(isPublicUrlBlocked(uploadThingDown, true)).toBe(true)
  })

  it('does not wash out the intake card when only file upload is unavailable', () => {
    const onSubmitUrl = vi.fn()
    render(
      <DatasetIntake
        status={uploadThingDown}
        onUploadFile={vi.fn()}
        onSubmitUrl={onSubmitUrl}
      />,
    )
    expect(document.querySelector('.intake-card')).not.toHaveClass('is-disabled')
    expect(screen.getByLabelText(UPLOAD_CSV_COPY)).toBeDisabled()
    expect(screen.getByRole('button', { name: UPLOAD_CSV_COPY })).toBeDisabled()
    expect(screen.getByLabelText(/public https csv url/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: USE_PUBLIC_CSV_URL_COPY })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/public https csv url/i), {
      target: { value: 'https://jev-gamecast.vercel.app/samples/nyc-squirrel-census.csv' },
    })
    fireEvent.click(screen.getByRole('button', { name: USE_PUBLIC_CSV_URL_COPY }))
    expect(onSubmitUrl).not.toHaveBeenCalled()
    expect(screen.getByText(/uploads are unavailable/i)).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: UPLOAD_CSV_COPY })).toBeDisabled()
    expect(screen.getByRole('button', { name: USE_PUBLIC_CSV_URL_COPY })).toBeDisabled()
  })
})
