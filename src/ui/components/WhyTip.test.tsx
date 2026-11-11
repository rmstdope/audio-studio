import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { WhyTip } = await import('./WhyTip')
const { off } = await import('../off')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterEach(async () => {
  cleanups.splice(0).forEach((c) => c())
  // Let React's scheduler and the observers settle before the DOM goes away.
  await new Promise<void>((r) => setTimeout(r, 20))
})
afterAll(() => GlobalRegistrator.unregister())

type Clicks = { presses: number; changes: number }

/** The layer with a button, a menu and an ordinary button, the first two greyed with `why`. */
function mount(initial: string | false, clicks: Clicks = { presses: 0, changes: 0 }) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const draw = (why: string | false) =>
    act(() => {
      root.render(
        createElement(
          'div',
          null,
          createElement(WhyTip),
          createElement(
            'button',
            { id: 'make', type: 'button', onClick: () => clicks.presses++, ...off(why) },
            'Make',
          ),
          createElement(
            'select',
            { id: 'menu', onChange: () => clicks.changes++, ...off(why) },
            createElement('option', null, 'a'),
          ),
          createElement('button', { id: 'plain', type: 'button' }, 'Plain'),
        ),
      )
    })
  draw(initial)
  cleanups.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  return { draw, clicks }
}

const el = (id: string) => document.getElementById(id) as HTMLElement
const tip = () => document.querySelector('[role="tooltip"]')
const fire = (target: Element, type: string, init: Record<string, unknown> = {}) =>
  act(() => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.assign(event, init)
    target.dispatchEvent(event)
  })
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)))

describe('the tip on a greyed control', () => {
  it('shows nothing on a control that is on', () => {
    mount(false)
    fire(el('make'), 'pointerover')
    expect(tip()).toBeNull()
    expect(el('make').hasAttribute('aria-disabled')).toBe(false)
  })

  it('shows at once with the reason when the pointer arrives, and goes when it leaves', async () => {
    mount('Wait for the takes.')
    fire(el('make'), 'pointerover')
    expect(tip()?.textContent).toBe('Wait for the takes.')
    fire(document.body, 'pointerover')
    await wait(250)
    expect(tip()).toBeNull()
  })

  it('stays when the pointer moves onto the tip to read it', async () => {
    mount('Wait for the takes.')
    fire(el('make'), 'pointerover')
    fire(tip()!, 'pointerover')
    await wait(250)
    expect(tip()?.textContent).toBe('Wait for the takes.')
  })

  it('shows while the control has focus and goes when focus moves on', () => {
    mount('Wait for the takes.')
    fire(el('make'), 'focusin')
    expect(tip()).not.toBeNull()
    fire(el('plain'), 'focusin')
    expect(tip()).toBeNull()
  })

  it('leaves the greyed control focusable, not natively disabled, and reading as dimmed with its reason', () => {
    mount('Wait for the takes.')
    expect((el('make') as HTMLButtonElement).disabled).toBe(false)
    expect(el('make').getAttribute('aria-disabled')).toBe('true')
    expect(el('make').getAttribute('aria-description')).toBe('Wait for the takes.')
  })

  it('shows on a tap and hides on a tap elsewhere', () => {
    mount('Wait for the takes.')
    fire(el('make'), 'click')
    expect(tip()).not.toBeNull()
    fire(el('plain'), 'pointerdown')
    expect(tip()).toBeNull()
  })

  it('hides on Esc and the focus stays on the control', () => {
    mount('Wait for the takes.')
    el('make').focus()
    fire(el('make'), 'focusin')
    fire(el('make'), 'keydown', { key: 'Escape' })
    expect(tip()).toBeNull()
    expect(document.activeElement).toBe(el('make'))
  })

  it('updates in place when the reason changes and goes when the control turns on', async () => {
    const { draw } = mount('Setup first.')
    fire(el('make'), 'pointerover')
    draw('Wait for the takes.')
    await wait(0)
    expect(tip()?.textContent).toBe('Wait for the takes.')
    draw(false)
    await wait(0)
    expect(tip()).toBeNull()
  })

  it('does nothing when the greyed control is pressed, by click, Enter, Space or a change', () => {
    const { clicks } = mount('Wait for the takes.')
    fire(el('make'), 'click')
    fire(el('make'), 'keydown', { key: 'Enter' })
    fire(el('make'), 'keyup', { key: ' ' })
    fire(el('menu'), 'change')
    fire(el('menu'), 'keydown', { key: 'ArrowDown' })
    expect(clicks).toEqual({ presses: 0, changes: 0 })
  })

  it('lets Tab through a greyed control', () => {
    mount('Wait for the takes.')
    const event = new Event('keydown', { bubbles: true, cancelable: true })
    Object.assign(event, { key: 'Tab' })
    el('make').dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
