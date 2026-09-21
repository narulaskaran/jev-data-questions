import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STAGE_FOLD_MS, StageFold } from './StageFold'

describe('StageFold motion', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('folds on a 300ms ease-out', () => {
    render(
      <StageFold open animate>
        <p>Shape</p>
      </StageFold>,
    )
    const fold = document.querySelector('[data-stage-fold]') as HTMLElement
    expect(fold).toHaveAttribute('data-fold-ms', String(STAGE_FOLD_MS))
    expect(STAGE_FOLD_MS).toBe(300)
    expect(fold).toHaveClass('is-animate')
    expect(fold.style.getPropertyValue('--stage-fold-ms')).toBe('300ms')
    expect(fold).toHaveAttribute('data-open', 'true')
  })

  it('snaps without a fold transition when reduced motion is preferred', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    }))
    render(
      <StageFold open animate>
        <p>Shape</p>
      </StageFold>,
    )
    const fold = document.querySelector('[data-stage-fold]') as HTMLElement
    expect(fold).toHaveAttribute('data-reduced-motion', 'true')
    expect(fold).not.toHaveClass('is-animate')
  })
})
