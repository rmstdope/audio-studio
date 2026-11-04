import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { useStopFocus } = await import('./useStopFocus')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => GlobalRegistrator.unregister())

function setup() {
  const lands: number[] = []
  function Probe({ busy }: { busy: boolean }) {
    const focus = useStopFocus(busy, () => lands.push(1))
    return busy ? createElement('button', { id: 'stop', ...focus }, 'Stop all') : null
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const show = (busy: boolean) => act(() => root.render(createElement(Probe, { busy })))
  return { lands, show, stop: () => container.querySelector('button')! }
}

describe('useStopFocus', () => {
  it('lands once when the work ends while focus was on Stop all', () => {
    const p = setup()
    p.show(true)
    act(() => p.stop().focus())
    p.show(false)
    expect(p.lands.length).toBe(1)
    p.show(false)
    expect(p.lands.length).toBe(1)
  })

  it('does nothing when focus was elsewhere or had left Stop all', () => {
    const p = setup()
    p.show(true)
    p.show(false)
    expect(p.lands.length).toBe(0)
    p.show(true)
    act(() => p.stop().focus())
    act(() => p.stop().blur())
    p.show(false)
    expect(p.lands.length).toBe(0)
  })
})
