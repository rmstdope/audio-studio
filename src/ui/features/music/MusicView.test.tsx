import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { MusicListSummary, TrackRow } from '../../../core/music'
import type { TrackStatus } from '../../../core/musicChoose'
import type { ProjectSummary } from '../../../core/summary'
import type { MusicRoute } from '../../route'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { MusicView } = await import('./MusicView')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// What the page asks the audio element to play, instead of playing it.
const played: string[] = []
HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
  played.push(this.src)
  return Promise.resolve()
}
HTMLMediaElement.prototype.pause = () => {}

const cleanups: (() => void)[] = []
afterAll(() => {
  cleanups.forEach((c) => c())
  GlobalRegistrator.unregister()
})

const track = (id: string, title: string, status: TrackStatus): TrackRow => ({
  id,
  title,
  plays: null,
  brief: 'A brief',
  seconds: 30,
  bpm: null,
  key: null,
  game: { brief: 'A brief', seconds: 30, bpm: null, key: null },
  status,
  changed: status === 'changed' ? ['brief'] : [],
  chosenAt: status === 'not-chosen' ? null : '2026-10-01T10:00:00.000Z',
  current:
    status === 'not-chosen'
      ? { kind: 'none' }
      : { kind: 'take', take: 3, exists: status !== 'missing' },
})

const list = (id: string, kind: MusicListSummary['kind']): MusicListSummary => ({
  id,
  kind,
  title: kind === 'act' ? 'Act I: The Lantern' : 'Stingers',
  state: 'ok',
  tracks: [
    track('hall', 'Lantern hall', 'chosen'),
    track('cellar', 'Cellar', 'changed'),
    track('tower', 'Tower', 'missing'),
    track('roof', 'Roof', 'not-chosen'),
  ],
  orphans: [],
  dropped: 0,
  canRefresh: false,
})

/** A list page's play buttons, by track title. */
function render(kind: MusicListSummary['kind']) {
  const id = kind === 'act' ? 'act1' : 'stingers'
  const summary = { music: { lists: [list(id, kind)] } } as unknown as ProjectSummary
  const route = (
    kind === 'act' ? { view: 'music', page: 'act', part: id } : { view: 'music', page: 'stingers' }
  ) as MusicRoute
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        {
          client: new QueryClient({
            defaultOptions: { queries: { retry: false, enabled: false } },
          }),
        },
        createElement(MusicView, { summary, route }),
      ),
    ),
  )
  const button = (title: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('td.music-play button')].find((b) =>
      b.getAttribute('aria-label')!.includes(title),
    )!
  return { button, container }
}

describe.each(['act', 'stingers'] as const)('the play button on a %s page', (kind) => {
  // A fresh page per case, so none starts with another's take playing.
  const button = (title: string) => render(kind).button(title)

  it('plays the chosen take’s music file', () => {
    const page = render(kind)
    const play = page.button('Lantern hall')
    expect(play.getAttribute('aria-label')).toBe('Play Lantern hall: take 3')
    played.length = 0
    act(() => play.click())
    expect(played).toEqual(['/api/music/tracks/hall/current'])
    expect(page.button('Lantern hall').getAttribute('aria-label')).toBe('Stop Lantern hall')
  })

  it('still plays a chosen take whose track changed since', () => {
    const play = button('Cellar')
    expect(play.getAttribute('aria-label')).toBe('Play Cellar: take 3')
    played.length = 0
    act(() => play.click())
    expect(played).toEqual(['/api/music/tracks/cellar/current'])
  })

  const playCell = (container: HTMLElement, title: string) =>
    [...container.querySelectorAll<HTMLTableRowElement>('tbody tr')]
      .find((r) => r.textContent!.includes(title))!
      .querySelector('td.music-play')!

  it('leaves the button out, and the Plays column says why, when the music file is missing', () => {
    const { container } = render(kind)
    expect(playCell(container, 'Tower').querySelector('button')).toBeNull()
    expect(playCell(container, 'Tower').parentElement!.textContent).toContain(
      'The file is not there.',
    )
  })

  it('leaves the button out, and the Plays column says why, when no take is chosen', () => {
    const { container } = render(kind)
    expect(playCell(container, 'Roof').querySelector('button')).toBeNull()
    expect(playCell(container, 'Roof').parentElement!.textContent).toContain('Nothing to play yet')
  })
})
