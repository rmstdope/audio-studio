import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement, useState } = await import('react')
const { WhyTip } = await import('../../components/WhyTip')
const { createRoot } = await import('react-dom/client')
const { LanguageSwitch } = await import('./LanguageSwitch')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterEach(async () => {
  cleanups.splice(0).forEach((c) => c())
  // Let React's scheduler and the observers settle before the DOM goes away.
  await new Promise<void>((r) => setTimeout(r, 20))
})
afterAll(() => GlobalRegistrator.unregister())

const tabs = [
  { id: 'sv', name: 'Svenska', count: '3/3', title: '3 of 3 lines up to date', dimmed: false },
  {
    id: 'de',
    name: 'Deutsch',
    count: 'No dialog',
    title: 'Act I has no Deutsch dialog yet',
    dimmed: true,
  },
]

/** The switch as a page holds it: choosing a tab makes it the active one. */
function Switch() {
  const [active, setActive] = useState('sv')
  return createElement(LanguageSwitch, { tabs, active, onChoose: setActive })
}

function render() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  act(() =>
    root.render([createElement(WhyTip, { key: 'tip' }), createElement(Switch, { key: 's' })]),
  )
  const tab = (id: string) => container.querySelector<HTMLElement>(`[data-language="${id}"]`)!
  return { tab }
}

describe('the language switch with the studio tip', () => {
  it('shows a dimmed tab’s reason when the arrow keys move onto it, as the page changes under the pointer', async () => {
    const { tab } = render()
    act(() => tab('sv').focus())
    act(() => {
      tab('sv').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
    })
    // The new language's page takes the old one's place under a resting pointer.
    act(() => {
      document.body.dispatchEvent(new Event('pointerover', { bubbles: true }))
    })
    await act(() => new Promise<void>((r) => setTimeout(r, 250)))
    expect(document.activeElement).toBe(tab('de'))
    expect(document.getElementById('why-tip')?.textContent).toBe('Act I has no Deutsch dialog yet')
    expect(tab('de').getAttribute('aria-describedby')).toBe('why-tip')
  })
})
