import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { HistoryMenu } = await import('./HistoryMenu')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((c) => c()))
afterAll(() => GlobalRegistrator.unregister())

/** Renders the menu with two steps (the second in the game); `props` change on `rerender`. */
async function render(props: { resetKey?: string; active?: boolean } = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const draw = (over: { resetKey?: string; active?: boolean }) =>
    act(async () =>
      root.render(
        createElement(HistoryMenu, {
          count: 2,
          resetKey: 'take-1',
          active: true,
          ...props,
          ...over,
          children: (close: () => void) => [
            createElement('button', { key: 1, id: 'one', onClick: close }, 'Take 1'),
            createElement(
              'span',
              { key: 2, id: 'now', tabIndex: -1, 'data-now': 'true' },
              'Take 2',
            ),
          ],
        }),
      ),
    )
  await draw({})
  cleanups.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  return { host, rerender: draw }
}
const toggle = (host: Element) => host.querySelector<HTMLButtonElement>('button.history-button')!
const key = (name: string) =>
  act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
    )
  })

describe('the History button', () => {
  it('says how many steps there are, keeps the list out while closed, and opens it', async () => {
    const { host } = await render()
    expect(toggle(host).textContent).toBe('History (2) ▾')
    expect(host.querySelector('.history-popover')).toBeNull()
    await act(async () => toggle(host).click())
    expect(toggle(host).textContent).toBe('History (2) ▴')
    expect(toggle(host).getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('.history-popover')).not.toBeNull()
  })

  it('moves focus to the step in the game on opening', async () => {
    const { host } = await render()
    await act(async () => toggle(host).click())
    expect(document.activeElement?.id).toBe('now')
  })

  it('closes on Esc, on a click outside and on the button again, focus back on the button', async () => {
    const { host } = await render()
    await act(async () => toggle(host).click())
    await key('Escape')
    expect(host.querySelector('.history-popover')).toBeNull()
    expect(document.activeElement).toBe(toggle(host))
    await act(async () => toggle(host).click())
    await act(async () =>
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })),
    )
    expect(host.querySelector('.history-popover')).toBeNull()
    await act(async () => toggle(host).click())
    await act(async () => toggle(host).click())
    expect(host.querySelector('.history-popover')).toBeNull()
  })

  it('closes when a step asks it to', async () => {
    const { host } = await render()
    await act(async () => toggle(host).click())
    await act(async () => host.querySelector<HTMLButtonElement>('#one')!.click())
    expect(host.querySelector('.history-popover')).toBeNull()
  })

  it('closes when another picture comes into the game, and when the tab is not the open one', async () => {
    const { host, rerender } = await render()
    await act(async () => toggle(host).click())
    await rerender({ resetKey: 'take-2' })
    expect(host.querySelector('.history-popover')).toBeNull()
    await act(async () => toggle(host).click())
    await rerender({ active: false })
    expect(host.querySelector('.history-popover')).toBeNull()
  })
})
