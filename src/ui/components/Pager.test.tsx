import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { Pager } = await import('./Pager')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

type Props = Parameters<typeof Pager>[0]
const middle: Props = {
  place: { position: 3, count: 12 },
  previous: { name: 'Harbour morning', href: '#/music/tracks/a' },
  next: { name: 'Market bustle', href: '#/music/tracks/c' },
}

function show(props: Props) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => root.render(createElement(Pager, props)))
  const [prev, next] = [...container.querySelectorAll<HTMLButtonElement>('button')]
  return {
    container,
    prev: prev!,
    next: next!,
    rerender: (p: Props) => act(() => root.render(createElement(Pager, p))),
    unmount: () => act(() => root.unmount()),
  }
}

const press = (key: string, target: Element = document.body) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })

describe('the previous/next control', () => {
  it('says where the item stands and names the neighbours on hover', () => {
    const p = show(middle)
    expect(p.container.textContent).toBe('‹3 of 12›')
    expect(p.prev.title).toBe('Previous: Harbour morning (←)')
    expect(p.next.title).toBe('Next: Market bustle (→)')
    expect(p.prev.getAttribute('aria-label')).toBe('Previous: Harbour morning')
    expect(p.next.getAttribute('aria-label')).toBe('Next: Market bustle')
    p.unmount()
  })

  it('greys out an end, keeping it in place and focusable', () => {
    const first = show({ ...middle, place: { position: 1, count: 12 }, previous: null })
    expect(first.prev.getAttribute('aria-disabled')).toBe('true')
    expect(first.prev.title).toBe('This is the first')
    expect(first.next.getAttribute('aria-disabled')).toBeNull()
    first.unmount()
    const last = show({ ...middle, place: { position: 12, count: 12 }, next: null })
    expect(last.next.getAttribute('aria-disabled')).toBe('true')
    expect(last.next.title).toBe('This is the last')
    last.unmount()
    const only = show({ place: { position: 1, count: 1 }, previous: null, next: null })
    expect(only.container.textContent).toBe('‹1 of 1›')
    expect(only.prev.getAttribute('aria-disabled')).toBe('true')
    expect(only.next.getAttribute('aria-disabled')).toBe('true')
    only.unmount()
  })

  it('moves by the address, from a button or an arrow key, and not past an end', () => {
    window.location.hash = '#/start'
    const p = show({ ...middle, previous: null })
    act(() => p.prev.click())
    press('ArrowLeft')
    expect(window.location.hash).toBe('#/start')
    act(() => p.next.click())
    expect(window.location.hash).toBe('#/music/tracks/c')
    window.location.hash = '#/start'
    press('ArrowRight')
    expect(window.location.hash).toBe('#/music/tracks/c')
    p.unmount()
  })

  it('without keys, leaves the arrows alone and leaves the key out of the hover', () => {
    window.location.hash = '#/start'
    const p = show({ ...middle, keys: false })
    expect(p.prev.title).toBe('Previous: Harbour morning')
    expect(p.next.title).toBe('Next: Market bustle')
    press('ArrowRight')
    press('ArrowLeft')
    expect(window.location.hash).toBe('#/start')
    act(() => p.next.click())
    expect(window.location.hash).toBe('#/music/tracks/c')
    p.unmount()
  })

  it('leaves the arrows to a field', () => {
    window.location.hash = '#/start'
    const p = show(middle)
    const field = document.createElement('input')
    document.body.append(field)
    press('ArrowRight', field)
    expect(window.location.hash).toBe('#/start')
    p.unmount()
    field.remove()
  })

  it('keeps focus on the pressed button on the next page, greyed out or not', () => {
    window.location.hash = '#/music/tracks/b'
    const p = show(middle)
    p.next.focus()
    act(() => p.next.click())
    p.unmount()
    // The next page opens at the address the press went to.
    const lastPage = show({
      place: { position: 4, count: 4 },
      previous: middle.previous,
      next: null,
    })
    expect(document.activeElement).toBe(lastPage.next)
    lastPage.unmount()
  })

  it('does not move focus on a page opened another way', () => {
    window.location.hash = '#/elsewhere'
    const p = show(middle)
    expect(document.activeElement).toBe(document.body)
    p.unmount()
  })
})
