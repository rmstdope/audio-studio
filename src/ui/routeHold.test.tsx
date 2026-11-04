import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { holdRoute, useRoute } = await import('./route')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((c) => c()))
afterAll(() => GlobalRegistrator.unregister())

/** Shows the view the address names, through the real `useRoute`. */
function show() {
  const Probe = () => createElement('p', null, useRoute().view)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  window.history.replaceState(null, '', '#/music')
  act(() => root.render(createElement(Probe)))
  return container
}

const goTo = (hash: string) => {
  window.history.replaceState(null, '', hash)
  act(() => {
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

describe('a page holding the route', () => {
  it('keeps the route where it is while the page says it stopped the move', () => {
    const page = show()
    cleanups.push(holdRoute(() => true))
    goTo('#/setup')
    expect(page.textContent).toBe('music')
  })

  it('lets the route follow once the page lets the move go', () => {
    const page = show()
    cleanups.push(holdRoute(() => false))
    goTo('#/setup')
    expect(page.textContent).toBe('setup')
  })

  it('is asked before the route changes, not after', () => {
    const page = show()
    const seen: (string | null)[] = []
    cleanups.push(
      holdRoute(() => {
        seen.push(page.textContent)
        return false
      }),
    )
    goTo('#/setup')
    expect(seen).toEqual(['music'])
  })

  it('is let go by its own release, but a later hold survives an earlier page’s release', () => {
    const page = show()
    const releaseFirst = holdRoute(() => false)
    const releaseSecond = holdRoute(() => true)
    // The first page goes away after the second has been mounted (an act switch).
    releaseFirst()
    goTo('#/setup')
    expect(page.textContent).toBe('music')
    releaseSecond()
    goTo('#/images')
    expect(page.textContent).toBe('images')
  })
})
