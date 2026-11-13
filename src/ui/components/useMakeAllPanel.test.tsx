import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { useMakeAllPanel } = await import('./useMakeAllPanel')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => GlobalRegistrator.unregister())

type Panel = ReturnType<typeof useMakeAllPanel>
type Props = { busy: boolean; summary: boolean; settled?: boolean }

/** A panel with a Make, a Stop all and a Close button, each drawn when the props say so. */
function mount(initial: Props) {
  const seen: { panel: Panel | null; reset: number } = { panel: null, reset: 0 }
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const Probe = ({ busy, summary, settled = false }: Props) => {
    const panel = useMakeAllPanel({
      busy,
      summary,
      settled,
      resetStop: () => seen.reset++,
    })
    seen.panel = panel
    return createElement(
      'div',
      { ref: panel.panel, tabIndex: -1, id: 'panel' },
      busy
        ? createElement('button', { ref: panel.stopButton, id: 'stop', ...panel.stopFocus })
        : summary
          ? createElement('button', { ref: panel.closeButton, id: 'close' })
          : createElement('button', { ref: panel.button, id: 'button' }),
      panel.open && createElement('button', { ref: panel.makeButton, id: 'make' }),
    )
  }
  const render = (props: Props) => act(async () => root.render(createElement(Probe, props)))
  return { seen, render, start: () => render(initial) }
}

describe('useMakeAllPanel', () => {
  it('focuses Make when the question opens', async () => {
    const m = mount({ busy: false, summary: false })
    await m.start()
    await act(async () => {
      m.seen.panel!.setOpen(true)
      m.seen.panel!.goTo('make')
    })
    expect(document.activeElement?.id).toBe('make')
  })

  it('closes the question when takes start, and does not bring it back', async () => {
    const m = mount({ busy: false, summary: false })
    await m.start()
    await act(async () => m.seen.panel!.setOpen(true))
    await m.render({ busy: true, summary: false })
    expect(m.seen.panel!.open).toBe(false)
    await m.render({ busy: false, summary: false })
    expect(m.seen.panel!.open).toBe(false)
  })

  it('waits for Stop all to be drawn, and drops the wish when the batch ended first', async () => {
    const m = mount({ busy: false, summary: false })
    await m.start()
    await act(async () => m.seen.panel!.goTo('stop'))
    await m.render({ busy: true, summary: false })
    expect(document.activeElement?.id).toBe('stop')
    await act(async () => m.seen.panel!.goTo('stop'))
    await m.render({ busy: false, summary: true, settled: true })
    expect(document.activeElement?.id).not.toBe('stop')
  })

  it('lands on Close when Stop all goes away under a summary, and on the panel otherwise', async () => {
    const m = mount({ busy: true, summary: false })
    await m.start()
    document.getElementById('stop')!.focus()
    await m.render({ busy: false, summary: true })
    expect(document.activeElement?.id).toBe('close')
  })

  it('lands on the button, or else the panel, when Stop all goes away with no summary', async () => {
    const m = mount({ busy: true, summary: false })
    await m.start()
    document.getElementById('stop')!.focus()
    await m.render({ busy: false, summary: false })
    expect(document.activeElement?.id).toBe('button')
  })

  it('resets the stop failure once nothing is being made', async () => {
    const m = mount({ busy: true, summary: false })
    await m.start()
    const before = m.seen.reset
    await m.render({ busy: false, summary: false })
    expect(m.seen.reset).toBeGreaterThan(before)
  })

  it('after Close, waits for the summary to go before focusing the button', async () => {
    const m = mount({ busy: false, summary: true })
    await m.start()
    await act(async () => m.seen.panel!.closed())
    expect(document.activeElement?.id).not.toBe('button')
    await m.render({ busy: false, summary: false })
    expect(document.activeElement?.id).toBe('button')
  })
})
