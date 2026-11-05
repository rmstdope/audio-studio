import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { TrackRow } from '../../../core/music'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { BriefPanel } = await import('./BriefPanel')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const realFetch = globalThis.fetch
const cleanups: (() => void)[] = []
afterAll(() => {
  cleanups.forEach((c) => c())
  globalThis.fetch = realFetch
  GlobalRegistrator.unregister()
})

const track: TrackRow = {
  id: 'hall',
  title: 'Hall',
  plays: null,
  brief: 'our lute',
  seconds: 30,
  bpm: null,
  key: null,
  game: { brief: 'the game’s new lute', seconds: 30, bpm: null, key: null },
  gameChanged: true,
  gameWas: 'the game’s old lute',
  status: 'not-chosen',
  changed: [],
  chosenAt: null,
  current: { kind: 'none' },
  gameFile: null,
}

/** The Brief panel of `row`, with the requests it sends. */
function render(row: TrackRow) {
  const calls: { method: string; url: string; body: unknown }[] = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      url,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
    return Response.json({ ok: true })
  }) as typeof fetch
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(BriefPanel, { track: row, kind: 'act' }),
      ),
    ),
  )
  const notice = () => container.querySelector('[aria-label="The game\'s brief changed"]')
  const button = (name: string) =>
    [...(notice()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === name)!
  return { calls, notice, button }
}

describe('a track whose brief the game changed', () => {
  it('says so with the game’s brief now, its brief still in force', () => {
    const { notice } = render(track)
    expect(notice()!.textContent).toContain("The game's brief changed since you changed yours.")
    expect(notice()!.textContent).toContain('the game’s new lute')
    expect(notice()!.textContent).toContain('Yours is still the one used.')
  })

  it('takes the game’s brief with Use the game’s', async () => {
    const { calls, button } = render(track)
    await act(async () => button("Use the game's").click())
    expect(calls[0]).toEqual({
      method: 'PATCH',
      url: '/api/music/tracks/hall',
      body: { brief: 'the game’s new lute' },
    })
  })

  it('keeps its own with Keep mine', async () => {
    const { calls, button } = render(track)
    await act(async () => button('Keep mine').click())
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/music/tracks/hall/keep-mine' })
  })

  it('shows no notice while the game’s brief is the one the studio’s was written over', () => {
    expect(render({ ...track, gameChanged: false }).notice()).toBeNull()
  })
})
