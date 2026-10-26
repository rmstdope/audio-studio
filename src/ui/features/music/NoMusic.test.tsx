import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { NoMusic } = await import('./NoMusic')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterAll(() => {
  cleanups.forEach((c) => c())
  GlobalRegistrator.unregister()
})

/** The no-music page, rendered into the test DOM. */
function render(): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  act(() => root.render(createElement(NoMusic)))
  return container
}

describe('NoMusic', () => {
  it('lays out frame 4: a Music crumb, the heading and a left-aligned card', () => {
    const page = render()
    expect(page.querySelector('.page-header .crumbs')?.textContent).toBe('Music')
    expect(page.querySelector('h1')?.textContent).toBe('Music')
    expect(page.querySelector('.empty-state')).toBeNull()
    const card = page.querySelector('section.panel.no-music')
    expect(card?.textContent).toContain('This project has no music yet')
    expect(card?.querySelector('button')?.textContent).toBe('How to set it up')
  })

  it('shows the example inside the card when the button is clicked', () => {
    const page = render()
    act(() => page.querySelector('button')?.click())
    expect(page.querySelector('section.no-music pre')?.textContent).toContain('"music": {')
  })
})
