import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register({ url: 'http://localhost/' })
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { useFillWindow } = await import('./fillWindow')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A ResizeObserver the test delivers to by hand, as the browser would after a layout. */
const observers: (() => void)[] = []
class FakeResizeObserver {
  constructor(private readonly callback: () => void) {
    observers.push(() => this.callback())
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Animation frames the test runs by hand. */
const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 1

const real = {
  ResizeObserver: globalThis.ResizeObserver,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
}
globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
globalThis.requestAnimationFrame = (callback) => {
  frames.set(nextFrame, callback)
  return nextFrame++
}
globalThis.cancelAnimationFrame = (id) => void frames.delete(id)
const runFrames = () => {
  const due = [...frames.values()]
  frames.clear()
  for (const callback of due) callback(0)
}

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((c) => c())
  observers.length = 0
  frames.clear()
})
afterAll(() => {
  Object.assign(globalThis, real)
  GlobalRegistrator.unregister()
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
  cleanups.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  const element = host.querySelector<HTMLElement>('[data-frame]')!
  element.getBoundingClientRect = () => ({ top }) as DOMRect
  return {
    height: () => element.style.getPropertyValue('--fill-height'),
    moveTo: (at: number) => void (top = at),
  }
}

describe('a frame that fills the window', () => {
  it('does not change its height inside a resize observation, which would resize what is observed (as-tp58)', async () => {
    const filled = await frame()
    const before = filled.height()
    // The Named areas tab opens: the frame's top moves, and the observer is told of the body's new size.
    filled.moveTo(300)
    for (const deliver of observers) deliver()
    // The browser refuses a size change made inside the delivery to a box it watches (the body):
    // "ResizeObserver loop completed with undelivered notifications."
    expect(filled.height()).toBe(before)
    runFrames()
    expect(filled.height()).toBe(`${window.innerHeight - 300}px`)
  })
})
