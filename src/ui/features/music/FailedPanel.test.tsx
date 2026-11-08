import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { FailedPanel } = await import('./MusicView')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterAll(() => {
  cleanups.forEach((c) => c())
  GlobalRegistrator.unregister()
})

function render(result: Parameters<typeof FailedPanel>[0]['result']): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  act(() =>
    root.render(createElement(FailedPanel, { result, error: null, onClose: () => undefined })),
  )
  return container
}

describe('FailedPanel', () => {
  it('says the command ran but the named areas could not be passed to the game, and what to do', () => {
    const page = render({
      ok: false,
      reason: 'areas',
      message: 'The command ran, but the named areas could not be passed to the game',
      detail: 'The images manifest could not be read. Fix it, then Refresh from the game again.',
      output: '',
    })
    expect(page.querySelector('.label')?.textContent).toBe('Refresh from the game')
    expect(page.querySelector('strong')?.textContent).toBe(
      'The command ran, but the named areas could not be passed to the game',
    )
    expect(page.querySelector('.notice')?.textContent).toBe(
      'The images manifest could not be read. Fix it, then Refresh from the game again.',
    )
  })

  it('keeps its usual label for a refresh that failed otherwise', () => {
    const page = render({ ok: false, reason: 'failed', message: 'boom', output: '' })
    expect(page.querySelector('.label')?.textContent).toBe('Refresh from the game failed')
  })
})
