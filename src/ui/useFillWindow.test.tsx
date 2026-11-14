import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
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

describe('a frame that fills the window, when a box it watches changes size (as-tp58)', () => {
  /** What the observer is told, delivered by hand as the browser would after a layout. */
  const observers: (() => void)[] = []
  /** Animation frames, run by hand. */
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 1
  const runFrames = () => {
    const due = [...frames.values()]
    frames.clear()
    for (const callback of due) callback(0)
  }
  const real = {
    ResizeObserver: globalThis.ResizeObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  }
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) {
        observers.push(() => callback())
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
    globalThis.requestAnimationFrame = (callback) => {
      frames.set(nextFrame, callback)
      return nextFrame++
    }
    globalThis.cancelAnimationFrame = (id) => void frames.delete(id)
  })
  afterAll(() => Object.assign(globalThis, real))
  const cleanups: (() => void)[] = []
  afterEach(() => {
    cleanups.splice(0).forEach((c) => c())
    observers.length = 0
    frames.clear()
  })

  /** A frame filled with `useFillWindow`, whose top on the page the test moves. */
  async function frame() {
    let top = 100
    function Frame() {
      return createElement('div', { ref: useFillWindow(), 'data-frame': '' })
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(createElement(Frame)))
    const unmount = () => {
      act(() => root.unmount())
      host.remove()
    }
    cleanups.push(unmount)
    const element = host.querySelector<HTMLElement>('[data-frame]')!
    element.getBoundingClientRect = () => ({ top }) as DOMRect
    return {
      height: () => element.style.getPropertyValue('--fill-height'),
      moveTo: (at: number) => void (top = at),
      deliver: () => observers.forEach((deliver) => deliver()),
      unmount: () => cleanups.splice(cleanups.indexOf(unmount), 1).forEach((c) => c()),
    }
  }

  it('does not change its height inside the observation, which would resize what is observed', async () => {
    window.innerHeight = 800
    const filled = await frame()
    const before = filled.height()
    // The Named areas tab opens: the frame's top moves, and the observer is told of the body's new size.
    filled.moveTo(300)
    filled.deliver()
    // The browser refuses a size change made inside the delivery to a box it watches (the body):
    // "ResizeObserver loop completed with undelivered notifications."
    expect(filled.height()).toBe(before)
    runFrames()
    expect(filled.height()).toBe('500px')
  })

  it('asks for one frame however often it is told before that frame, and none once it is gone', async () => {
    const filled = await frame()
    filled.deliver()
    filled.deliver()
    expect(frames.size).toBe(1)
    filled.unmount()
    expect(frames.size).toBe(0)
  })
})
