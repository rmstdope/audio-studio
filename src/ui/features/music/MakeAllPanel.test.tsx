import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { MusicListSummary, TrackRow } from '../../../core/music'
import type { TrackStatus } from '../../../core/musicChoose'
import type { MusicMakingSummary } from '../../../core/musicTake'
import type { MakeAllBatch } from '../../api'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { MakeAllPanel } = await import('./MakeAllPanel')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
const realFetch = globalThis.fetch
afterAll(() => {
  globalThis.fetch = realFetch
  cleanups.forEach((c) => c())
  GlobalRegistrator.unregister()
})

const track = (id: string, title: string, status: TrackStatus, seconds = 30): TrackRow => ({
  id,
  title,
  plays: null,
  brief: 'A brief',
  seconds,
  bpm: null,
  key: null,
  game: { brief: 'A brief', seconds, bpm: null, key: null },
  status,
  changed: [],
  chosenAt: null,
  current: { kind: 'none' },
  gameFile: null,
})

const list = (tracks: TrackRow[]): MusicListSummary => ({
  id: 'act1',
  kind: 'act',
  title: 'Act I',
  state: 'ok',
  tracks,
  orphans: [],
  dropped: 0,
  canRefresh: false,
})

const four = list([
  track('forest', 'Forest path', 'not-chosen'),
  track('cave', 'Cave drip', 'not-chosen'),
  track('tavern', 'Tavern at dusk', 'chosen'),
  track('storm', 'Storm at sea', 'changed'),
])

interface Options {
  making?: Record<string, MusicMakingSummary>
  model?: { model: string; ready: boolean; message: string | null }
  batch?: MakeAllBatch
  answer?: { status: number; body: unknown }
  /** What the server reports being made once it has queued the takes. */
  started?: Record<string, MusicMakingSummary>
  /** What Stop all answers: how many takes were stopped on each track. */
  stopped?: Record<string, number>
}

/** The panel on a list, with what the server would have said, and the requests it makes. */
function render(subject: MusicListSummary, options: Options = {}) {
  const requests: { url: string; method: string }[] = []
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url: String(url), method: init?.method ?? 'GET' })
    if (String(url).endsWith('/stop')) {
      const byTrack = options.stopped ?? {}
      const stopped = Object.values(byTrack).reduce((a, b) => a + b, 0)
      return new Response(JSON.stringify({ ok: true, stopped, byTrack }), { status: 200 })
    }
    const answer = options.answer ?? { status: 200, body: { ok: true, tracks: 2, takes: 8 } }
    if (options.started && String(url).endsWith('/make-all')) {
      client.setQueryData(['music-making'], options.started)
    }
    return new Response(JSON.stringify(answer.body), { status: answer.status })
  }) as unknown as typeof fetch
  client.setQueryData(['music-making'], options.making ?? {})
  client.setQueryData(['music-model-state'], {
    ok: true,
    ...(options.model ?? { model: 'balanced', ready: true, message: null }),
  })
  if (options.batch) client.setQueryData(['music-batch', subject.id], options.batch)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(MakeAllPanel, {
          list: subject,
          children: createElement('div', null, 'COUNT'),
        }),
      ),
    ),
  )
  const button = (name: string): HTMLButtonElement =>
    [...container.querySelectorAll<HTMLElement>('button, a')].find(
      (b) => b.textContent === name,
    ) as HTMLButtonElement
  const press = async (name: string) => {
    await act(async () => {
      button(name).click()
    })
  }
  return { container, client, requests, button, press, text: () => container.textContent ?? '' }
}

describe('Make takes for every track with no chosen take', () => {
  it('offers four takes for each track with no chosen take, and starts nothing by itself', () => {
    const page = render(four)
    expect(page.text()).toContain('2 tracks have no chosen take')
    expect(page.button('Make 4 takes each')).toBeDefined()
    expect(page.requests).toEqual([])
  })

  it('asks first, naming the tracks, the model and who is left out, with focus on Make', async () => {
    const page = render(four)
    await page.press('Make 4 takes each')
    expect(page.text()).toContain('Make 8 takes for 2 tracks?')
    expect(page.text()).toContain(
      'Four takes each, on Balanced, the music model on Setup. About 24 min in all',
    )
    expect(page.text()).toContain('Forest path')
    expect(page.text()).toContain('Cave drip')
    expect(page.text()).toContain(
      'Tavern at dusk and Storm at sea have a chosen take and get none.',
    )
    expect(document.activeElement).toBe(page.button('Make 8 takes'))
    expect(page.requests).toEqual([])
  })

  it('writes nothing on Cancel or Escape, and puts focus back on the button', async () => {
    const page = render(four)
    await page.press('Make 4 takes each')
    await page.press('Cancel')
    expect(page.text()).not.toContain('Make 8 takes for')
    expect(document.activeElement).toBe(page.button('Make 4 takes each'))
    await page.press('Make 4 takes each')
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(page.text()).not.toContain('Make 8 takes for')
    expect(document.activeElement).toBe(page.button('Make 4 takes each'))
    expect(page.requests).toEqual([])
  })

  it('starts the takes on Make, then shows what is being made with focus on Stop all', async () => {
    const page = render(four, {
      started: {
        forest: { takes: 4, left: 720, failed: 0 },
        cave: { takes: 4, left: 720, failed: 0 },
      },
    })
    await page.press('Make 4 takes each')
    await page.press('Make 8 takes')
    expect(page.requests[0]).toEqual({ url: '/api/music/lists/act1/make-all', method: 'POST' })
    expect(page.text()).not.toContain('Make 8 takes for')
    expect(page.text()).toContain('Making 8 takes for 2 tracks · about 24 min left')
    expect(document.activeElement).toBe(page.button('Stop all'))
  })

  it('says it could not start them, leaving the button', async () => {
    const page = render(four, { answer: { status: 409, body: { ok: false, message: 'no' } } })
    await page.press('Make 4 takes each')
    await page.press('Make 8 takes')
    expect(page.text()).toContain('The takes could not be started. Nothing was made; try again.')
    expect(page.text()).not.toContain('Make 8 takes for')
    expect(page.button('Make 4 takes each')).toBeDefined()
    expect(document.activeElement).toBe(page.button('Make 4 takes each'))
  })

  it('shows a running line instead of the button, counting everything made in the act', () => {
    const page = render(four, {
      making: {
        forest: { takes: 3, left: 600, failed: 0 },
        tavern: { takes: 2, left: 120, failed: 0 },
        elsewhere: { takes: 9, left: 9999, failed: 0 },
      },
    })
    expect(page.text()).toContain('Making 5 takes for 2 tracks · about 12 min left')
    expect(page.button('Make 4 takes each')).toBeUndefined()
    expect(page.button('Stop all')).toBeDefined()
  })

  it('stops everything in the act on Stop all, with a warning on a paid model', async () => {
    const page = render(four, {
      making: { forest: { takes: 3, left: 600, failed: 0 } },
      model: { model: 'eleven', ready: true, message: null },
    })
    expect(page.button('Stop all')!.title).toBe(
      'ElevenLabs may still bill a take that is stopped while it is being made.',
    )
    const free = render(four, { making: { forest: { takes: 3, left: 600, failed: 0 } } })
    expect(free.button('Stop all')!.title).toBe('')
    await free.press('Stop all')
    expect(free.requests[0]).toEqual({ url: '/api/music/lists/act1/stop', method: 'POST' })
  })

  const batch: MakeAllBatch = {
    total: 16,
    tracks: ['forest', 'cave'],
    failedBefore: {},
    stopped: 0,
  }

  it('sums up a press when the last take is done, until Close', async () => {
    const page = render(four, { batch })
    expect(page.text()).toContain('Made 16 of 16 takes.')
    await page.press('Close')
    expect(page.text()).not.toContain('Made 16 of 16')
    expect(document.activeElement).toBe(page.button('Make 4 takes each'))
  })

  it('names the tracks with a failed take, linking to their pages, and not the failures from before', () => {
    const page = render(four, {
      batch: { ...batch, failedBefore: { cave: 1 } },
      making: { forest: { takes: 0, left: 0, failed: 2 }, cave: { takes: 0, left: 0, failed: 1 } },
    })
    expect(page.text()).toContain(
      'Made 14 of 16 takes. 2 could not be made — Forest path says why.',
    )
    expect(page.container.querySelector('a[href="#/music/tracks/forest"]')).not.toBeNull()
  })

  it('says how many were stopped, and failed too if some failed', () => {
    const page = render(four, { batch: { ...batch, stopped: 10 } })
    expect(page.text()).toContain('Made 6 of 16 takes. 10 were stopped.')
    const both = render(four, {
      batch: { ...batch, stopped: 4 },
      making: { forest: { takes: 0, left: 0, failed: 2 } },
    })
    expect(both.text()).toContain(
      'Made 10 of 16 takes. 2 could not be made — Forest path says why. 4 were stopped.',
    )
  })

  it('counts as stopped only the takes of the tracks the press made, not those started by hand', async () => {
    const page = render(four, {
      batch,
      making: {
        forest: { takes: 10, left: 100, failed: 0 },
        storm: { takes: 6, left: 60, failed: 0 },
      },
      stopped: { forest: 10, storm: 6 },
    })
    await page.press('Stop all')
    await act(async () => {
      page.client.setQueryData(['music-making'], {})
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(page.text()).toContain('Made 6 of 16 takes. 10 were stopped.')
  })

  it('does not bring the question back by itself when takes started elsewhere are done', async () => {
    const page = render(four)
    await page.press('Make 4 takes each')
    await act(async () => {
      page.client.setQueryData(['music-making'], { forest: { takes: 2, left: 60, failed: 0 } })
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(page.text()).not.toContain('Make 8 takes for')
    await act(async () => {
      page.client.setQueryData(['music-making'], {})
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(page.text()).not.toContain('Make 8 takes for')
    expect(page.button('Make 4 takes each')).toBeDefined()
  })

  it('prefers what is being made to a summary', () => {
    const page = render(four, {
      batch,
      making: { forest: { takes: 1, left: 60, failed: 0 } },
    })
    expect(page.text()).toContain('Making 1 take for 1 track')
    expect(page.text()).not.toContain('Made 16')
  })

  it('puts the total price on a paid model’s button', async () => {
    const page = render(four, { model: { model: 'eleven', ready: true, message: null } })
    await page.press('Make 4 takes each')
    expect(page.text()).toContain('ElevenLabs bills each take.')
    // Two 30 s loops: (30+20) s at $0.15 a minute is 13 cents a take, eight takes.
    expect(page.button('Make 8 takes · $1.04')).toBeDefined()
  })

  it('names tracks too long for the model, and those already making takes', async () => {
    const long = list([
      track('a', 'Forest path', 'not-chosen', 100),
      track('b', 'Market square', 'not-chosen', 90),
      track('c', 'Short one', 'not-chosen', 10),
    ])
    const page = render(long, { model: { model: 'short', ready: true, message: null } })
    await page.press('Make 4 takes each')
    expect(page.text()).toContain('Make 4 takes for 1 track?')
    expect(page.text()).toContain(
      'Left out: Forest path and Market square are longer than Short can make',
    )
  })

  it('says when the model can make none of them, with a way to Setup', () => {
    const long = list([
      track('a', 'Forest path', 'not-chosen', 100),
      track('b', 'Market square', 'not-chosen', 90),
    ])
    const page = render(long, { model: { model: 'short', ready: true, message: null } })
    expect(page.text()).toContain(
      "Short can't make any of the 2 tracks with no chosen take at their length.",
    )
    expect(page.button('Open Setup')!.getAttribute('href')).toBe('#/setup')
    expect(page.button('Make 4 takes each')).toBeUndefined()
  })

  it('says when music cannot be made yet', () => {
    const page = render(four, { model: { model: 'balanced', ready: false, message: 'no GPU' } })
    expect(page.text()).toContain("Music can't be made yet. Setup says what is missing.")
    expect(page.button('Open Setup')).toBeDefined()
    expect(page.button('Make 4 takes each')).toBeUndefined()
  })

  it('says when every track has a chosen take, with no button', () => {
    const page = render(list([track('a', 'Hall', 'chosen'), track('b', 'Cellar', 'changed')]))
    expect(page.text()).toContain('Every track has a chosen take.')
    expect(page.container.querySelector('button')).toBeNull()
  })
})
