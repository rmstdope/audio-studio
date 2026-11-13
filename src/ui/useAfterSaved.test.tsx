import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { useAfterSaved } = await import('./useAfterSaved')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => GlobalRegistrator.unregister())

type Hook = ReturnType<typeof useAfterSaved>

/** Renders the hook and returns a view of its latest value. */
async function render(save: (() => Promise<boolean> | null) | undefined) {
  const seen: { current: Hook | null } = { current: null }
  const Probe = () => {
    seen.current = useAfterSaved(save)
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(createElement(Probe)))
  return seen as { current: Hook }
}

describe('useAfterSaved', () => {
  it('asks at once when there is nothing to save', async () => {
    const hook = await render(() => null)
    let asked = 0
    await act(async () => hook.current.afterSaved(() => asked++))
    expect(asked).toBe(1)
    expect(hook.current.waiting).toBe(false)
  })

  it('asks at once without a way to save', async () => {
    const hook = await render(undefined)
    let asked = 0
    await act(async () => hook.current.afterSaved(() => asked++))
    expect(asked).toBe(1)
  })

  it('waits for a save under way, then asks', async () => {
    let finish: (saved: boolean) => void = () => {}
    const hook = await render(() => new Promise<boolean>((resolve) => (finish = resolve)))
    let asked = 0
    await act(async () => hook.current.afterSaved(() => asked++))
    expect(asked).toBe(0)
    expect(hook.current.waiting).toBe(true)
    await act(async () => finish(true))
    expect(asked).toBe(1)
    expect(hook.current.waiting).toBe(false)
  })

  it('never asks when the save failed', async () => {
    let finish: (saved: boolean) => void = () => {}
    const hook = await render(() => new Promise<boolean>((resolve) => (finish = resolve)))
    let asked = 0
    await act(async () => hook.current.afterSaved(() => asked++))
    await act(async () => finish(false))
    expect(asked).toBe(0)
    expect(hook.current.waiting).toBe(false)
  })
})

describe('useLatestSave', () => {
  it('holds a save until it settles, and only the newest', async () => {
    const { useLatestSave } = await import('./useAfterSaved')
    const seen: { current: ReturnType<typeof useLatestSave> | null } = { current: null }
    const Probe = () => {
      seen.current = useLatestSave()
      return null
    }
    await act(async () => createRoot(document.createElement('div')).render(createElement(Probe)))
    const hook = seen as { current: ReturnType<typeof useLatestSave> }
    expect(hook.current.current()).toBeNull()
    let first: (v: boolean) => void = () => {}
    let second: (v: boolean) => void = () => {}
    const a = hook.current.track(new Promise<boolean>((r) => (first = r)))
    const b = hook.current.track(new Promise<boolean>((r) => (second = r)))
    first(true)
    await a
    expect(hook.current.current()).toBe(b)
    second(true)
    await b
    await Promise.resolve()
    expect(hook.current.current()).toBeNull()
  })
})
