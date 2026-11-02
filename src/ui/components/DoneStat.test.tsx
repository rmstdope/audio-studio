import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { DoneStat } = await import('./DoneStat')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

function show(done: number, total: number) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() =>
    root.render(createElement(DoneStat, { label: 'Lines up to date', done, total, href: '#/x' })),
  )
  const ring = container.querySelector<HTMLElement>('.done-ring')!
  return { ring, unmount: () => act(() => root.unmount()) }
}

describe('the ring beside a list’s up-to-date count', () => {
  it('fills to the share done, rounded down so it is full only when all are', () => {
    const most = show(620, 624)
    expect(most.ring.style.getPropertyValue('--done')).toBe('99%')
    expect(most.ring.textContent).toBe('99%')
    expect(most.ring.getAttribute('aria-hidden')).toBe('true')
    most.unmount()
    const all = show(88, 88)
    expect(all.ring.textContent).toBe('100%')
    all.unmount()
  })

  it('is empty for a list with nothing in it', () => {
    const none = show(0, 0)
    expect(none.ring.style.getPropertyValue('--done')).toBe('0%')
    expect(none.ring.textContent).toBe('—')
    none.unmount()
  })
})
