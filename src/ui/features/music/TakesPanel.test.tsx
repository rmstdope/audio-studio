import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { TrackRow } from '../../../core/music'
import type { MakingView, MusicTakesView } from '../../../core/musicTake'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { TakesPanel } = await import('./TakesPanel')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterAll(() => {
  cleanups.forEach((c) => c())
  GlobalRegistrator.unregister()
})

const track: TrackRow = {
  id: 'hall',
  title: 'Lantern hall',
  plays: null,
  brief: 'A brief',
  seconds: 30,
  bpm: null,
  key: null,
  game: { brief: 'A brief', seconds: 30, bpm: null, key: null },
  status: 'not-chosen',
  changed: [],
  chosenAt: null,
  current: { kind: 'none' },
}

/** The Takes panel's Stop button, with these takes being made. */
function stopButton(making: MakingView[]) {
  const view: MusicTakesView = {
    ok: true,
    kind: 'loop',
    generator: { ok: true },
    expected: 180,
    takes: [],
    making,
    failed: [],
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(['music-takes', 'hall'], view)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  act(() =>
    root.render(
      createElement(QueryClientProvider, { client }, createElement(TakesPanel, { track })),
    ),
  )
  return [...container.querySelectorAll('button')].find((b) => b.textContent === 'Stop')
}

describe('the Takes panel’s Stop', () => {
  it('can stop the last take while it is being made, with none waiting', () => {
    expect(stopButton([{ n: 1, state: 'making', elapsed: 20 }])?.disabled).toBe(false)
  })

  it('can stop takes waiting behind the one being made', () => {
    const making: MakingView[] = [
      { n: 1, state: 'making', elapsed: 20 },
      { n: 2, state: 'waiting', elapsed: 0 },
    ]
    expect(stopButton(making)?.disabled).toBe(false)
  })
})
