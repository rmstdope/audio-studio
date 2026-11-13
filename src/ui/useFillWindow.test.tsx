import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register({ url: 'http://localhost/' })
const { act, createElement, useCallback } = await import('react')
const { createRoot } = await import('react-dom/client')
const { useFillWindow } = await import('./fillWindow')
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => GlobalRegistrator.unregister())

/** A page of `banners` boxes of 50 px above a frame, laid out by hand (the DOM has no layout). */
function Page({ banners }: { banners: number }) {
  const fill = useFillWindow()
  // Stable, as the pages' own ref is: it is not called again by a later render.
  const ref = useCallback(
    (el: HTMLElement | null) => {
      // The box's place is read from how many boxes are laid out before it, as a layout would.
      if (el) {
        el.getBoundingClientRect = () =>
          ({ top: 50 * el.parentElement!.querySelectorAll('.banner').length }) as DOMRect
      }
      fill(el)
    },
    [fill],
  )
  return createElement(
    'div',
    null,
    Array.from({ length: banners }, (_, i) => createElement('p', { key: i, className: 'banner' })),
    createElement('div', { className: 'frame', ref }),
  )
}

describe('a frame that fills the window (as-5wln)', () => {
  it('grows back when a box laid out before it goes away, and shrinks when one comes', async () => {
    window.innerHeight = 800
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const height = () =>
      host.querySelector<HTMLElement>('.frame')!.style.getPropertyValue('--fill-height')
    await act(async () => root.render(createElement(Page, { banners: 0 })))
    expect(height()).toBe('800px')
    await act(async () => root.render(createElement(Page, { banners: 2 })))
    await new Promise((r) => setTimeout(r, 0))
    expect(height()).toBe('700px')
    await act(async () => root.render(createElement(Page, { banners: 0 })))
    await new Promise((r) => setTimeout(r, 0))
    expect(height()).toBe('800px')
    act(() => root.unmount())
  })
})
