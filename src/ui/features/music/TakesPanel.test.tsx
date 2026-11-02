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
  gameFile: null,
}

/** The Takes panel's Stop button, with these takes being made. */
function stopButton(making: MakingView[]) {
  const view: MusicTakesView = {
    ok: true,
    kind: 'loop',
    generator: { ok: true },
    defaultModel: 'balanced',
    models: [{ id: 'balanced', installed: true }],
    takes: [],
    making,
    failed: [],
    lockUnread: false,
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(['music-takes', 'hall'], view)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(TakesPanel, { track, lists: [] }),
      ),
    ),
  )
  return [...container.querySelectorAll('button')].find((b) => b.textContent === 'Stop')
}

describe('the Takes panel’s Stop', () => {
  it('can stop the last take while it is being made, with none waiting', () => {
    expect(
      stopButton([
        {
          n: 1,
          state: 'making',
          elapsed: 20,
          model: 'Balanced · XL turbo · 4B',
          expected: 180,
          paid: false,
        },
      ])?.disabled,
    ).toBe(false)
  })

  it('can stop takes waiting behind the one being made', () => {
    const making: MakingView[] = [
      {
        n: 1,
        state: 'making',
        elapsed: 20,
        model: 'Balanced · XL turbo · 4B',
        expected: 180,
        paid: false,
      },
      {
        n: 2,
        state: 'waiting',
        elapsed: 0,
        model: 'Balanced · XL turbo · 4B',
        expected: 180,
        paid: false,
      },
    ]
    expect(stopButton(making)?.disabled).toBe(false)
  })
})

/** An audio element that plays at once, five seconds into a ten-second take. */
class FakeAudio {
  static made: FakeAudio[] = []
  src = ''
  loop = false
  currentTime = 0
  duration = 10
  volume = 1
  paused = true
  constructor() {
    FakeAudio.made.push(this)
  }
  play() {
    this.paused = false
    this.currentTime = 5
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
  addEventListener() {}
  removeEventListener() {}
}

/** The panel with one take of a track of this kind, its audio element a fake. */
async function withTake(kind: 'loop' | 'stinger') {
  const realAudio = globalThis.Audio
  globalThis.Audio = FakeAudio as unknown as typeof Audio
  cleanups.push(() => (globalThis.Audio = realAudio))
  const view: MusicTakesView = {
    ok: true,
    kind,
    generator: { ok: true },
    defaultModel: 'balanced',
    models: [{ id: 'balanced', installed: true }],
    takes: [
      {
        n: 1,
        file: 'abc.1.wav',
        seconds: 10,
        peaks: [0.5, 0.5, 0.5, 0.5],
        earlier: false,
        chosen: false,
        model: 'Balanced · XL turbo · 4B',
      },
    ],
    making: [],
    failed: [],
    lockUnread: false,
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(['music-takes', 'hall'], view)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(TakesPanel, { track, lists: [] }),
      ),
    ),
  )
  await act(async () => {})
  return container
}

describe('playing a take', () => {
  it('plays a loop round and round, with a line on its waveform where it is', async () => {
    const container = await withTake('loop')
    expect(container.querySelector('.wave .playhead')).toBeNull()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Play take 1"]')!.click()
    })
    expect(FakeAudio.made.at(-1)!.loop).toBe(true)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    const head = container.querySelector<HTMLElement>('.wave .playhead')
    expect(head?.style.left).toBe('50%')
  })

  it('plays a stinger once', async () => {
    const container = await withTake('stinger')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Play take 1"]')!.click()
    })
    expect(FakeAudio.made.at(-1)!.loop).toBe(false)
    expect(container.querySelector('.wave .playhead')).not.toBeNull()
  })
})
