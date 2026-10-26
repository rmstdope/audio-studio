import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { LineState } from '../../../core/planner'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { LineWords } = await import('./CueGaps')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: { unmount: () => void }[] = []

afterAll(() => {
  act(() => roots.forEach((r) => r.unmount()))
  GlobalRegistrator.unregister()
})

/** Renders a line with one cue placed at word 2, and opens the box on the slot at `at`. */
function openBox(at: number): HTMLElement {
  const line = {
    key: 'a',
    speaker: 'x',
    text: 'one two three',
    cue: '',
    inside: [{ at: 2, cue: 'soft' }],
    insideStale: null,
  } as unknown as LineState
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(LineWords, {
          partId: 'p',
          line,
          chunkLimit: 100,
          playing: null,
          toggle: () => {},
        }),
      ),
    ),
  )
  act(() => {
    container.querySelector<HTMLButtonElement>(`.cue-slot[data-at="${at}"]`)!.click()
  })
  return container
}

/** The classes of each button in the open box, by its label. */
function boxButtons(container: HTMLElement): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const b of container.querySelectorAll('.cue-actions button'))
    out[b.textContent ?? ''] = b.classList.contains('btn-primary')
  return out
}

describe('the cue box buttons', () => {
  it('makes Add the primary action on a gap', () => {
    expect(boxButtons(openBox(1))).toEqual({
      Add: true,
      Cancel: false,
      'Hear it': false,
    })
  })

  it('makes Save the primary action on a chip', () => {
    expect(boxButtons(openBox(2))).toEqual({
      Save: true,
      Remove: false,
      Cancel: false,
      'Hear it': false,
    })
  })
})
