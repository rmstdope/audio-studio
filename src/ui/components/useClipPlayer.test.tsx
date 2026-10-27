import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { useClipPlayer } = await import('./useClipPlayer')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

/** An audio element that records its volume each time it is set, and plays at once. */
class FakeAudio {
  static made: FakeAudio[] = []
  src = ''
  currentTime = 0
  duration = 100
  paused = true
  volumes: number[] = []
  #volume = 1
  get volume() {
    return this.#volume
  }
  set volume(value: number) {
    this.#volume = value
    this.volumes.push(value)
  }
  constructor() {
    FakeAudio.made.push(this)
  }
  play() {
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
  addEventListener() {}
  removeEventListener() {}
}

describe('useClipPlayer', () => {
  it('fades a take for the length the project names, and not at all for 0', async () => {
    const realFetch = globalThis.fetch
    const realAudio = globalThis.Audio
    globalThis.fetch = (async () =>
      Response.json({ ok: true, summary: { takeFade: 0 } })) as unknown as typeof fetch
    globalThis.Audio = FakeAudio as unknown as typeof Audio
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    let toggle: ReturnType<typeof useClipPlayer>['toggle'] = () => {}
    function Probe() {
      toggle = useClipPlayer().toggle
      return null
    }
    try {
      act(() =>
        root.render(
          createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Probe)),
        ),
      )
      for (let i = 0; i < 20; i++) await act(() => new Promise((r) => setTimeout(r, 10)))
      const audio = FakeAudio.made.at(-1)!
      // The project says No fade: the take plays as it is, at full volume.
      act(() => toggle('a', '/a.mp3', { fade: true }))
      expect(audio.volume).toBe(1)
      act(() => toggle('a', '/a.mp3', { fade: true }))
      expect(audio.paused).toBe(true)
      expect(audio.volumes.every((v) => v === 1)).toBe(true)
    } finally {
      act(() => root.unmount())
      globalThis.fetch = realFetch
      globalThis.Audio = realAudio
    }
  })

  it('fades a take in from silence while the project has not answered (0.2 s)', async () => {
    const realFetch = globalThis.fetch
    const realAudio = globalThis.Audio
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch
    globalThis.Audio = FakeAudio as unknown as typeof Audio
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    let toggle: ReturnType<typeof useClipPlayer>['toggle'] = () => {}
    function Probe() {
      toggle = useClipPlayer().toggle
      return null
    }
    try {
      act(() =>
        root.render(
          createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Probe)),
        ),
      )
      const audio = FakeAudio.made.at(-1)!
      act(() => toggle('a', '/a.mp3', { fade: true }))
      expect(audio.volume).toBe(0)
    } finally {
      act(() => root.unmount())
      globalThis.fetch = realFetch
      globalThis.Audio = realAudio
    }
  })
})
