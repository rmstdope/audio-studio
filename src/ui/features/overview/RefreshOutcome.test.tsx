import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { RefreshOutcome } = await import('./PartOverview')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterAll(() => {
  cleanups.forEach((c) => c())
  GlobalRegistrator.unregister()
})

describe('RefreshOutcome', () => {
  it('shows what to do when the dialog was refreshed but the named areas could not be passed on', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    cleanups.push(() => act(() => root.unmount()))
    act(() =>
      root.render(
        createElement(RefreshOutcome, {
          result: {
            ok: false,
            reason: 'areas',
            message: 'The command ran, but the named areas could not be passed to the game',
            detail:
              'The images manifest could not be read. Fix it, then Refresh from the game again.',
            output: '',
          },
          error: null,
          onClose: () => undefined,
        }),
      ),
    )
    expect(container.textContent).toContain('could not be passed to the game')
    expect(container.querySelector('.notice')?.textContent).toBe(
      'The images manifest could not be read. Fix it, then Refresh from the game again.',
    )
  })
})
