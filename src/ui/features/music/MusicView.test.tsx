import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { MusicListSummary, OrphanRow, TrackRow } from '../../../core/music'
import type { TrackStatus } from '../../../core/musicChoose'
import type { ProjectSummary } from '../../../core/summary'
import type { MusicRoute } from '../../route'
import { readFileSync } from 'node:fs'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { MusicView } = await import('./MusicView')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// What the page asks the audio element to play, instead of playing it.
const played: string[] = []
// The element's volume when play began: 0 when a fade-in starts, 1 when there is no fade.
const volumes: number[] = []
HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
  played.push(this.src)
  volumes.push(this.volume)
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
  gameFile: null,
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
    {
      ...track('gate', 'Gate', 'chosen'),
      current: { kind: 'game', file: 'music/gate.ogg', exists: true },
    },
  ],
  orphans: [],
  dropped: 0,
  canRefresh: false,
})

/** A list page's play buttons, by track title. */
function render(kind: MusicListSummary['kind'], show?: 'attention', orphans: OrphanRow[] = []) {
  const id = kind === 'act' ? 'act1' : 'stingers'
  const summary = {
    music: { lists: [{ ...list(id, kind), orphans }] },
  } as unknown as ProjectSummary
  const route = (
    kind === 'act'
      ? { view: 'music', page: 'act', part: id, show }
      : { view: 'music', page: 'stingers', show }
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

  it('fades a chosen take in, and plays the game’s own file without a fade', () => {
    const take = button('Lantern hall')
    const game = button('Gate')
    volumes.length = 0
    act(() => take.click())
    expect(volumes).toEqual([0])
    volumes.length = 0
    act(() => game.click())
    expect(volumes).toEqual([1])
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

describe.each(['act', 'stingers'] as const)('what needs attention on a %s page', (kind) => {
  const titles = (container: HTMLElement) =>
    [...container.querySelectorAll('tbody tr strong')].map((s) => s.textContent)
  const href = kind === 'act' ? '#/music/parts/act1' : '#/music/stingers'

  it('counts the tracks up to date at the top, a link to the ones that need attention', () => {
    const { container } = render(kind)
    const stat = container.querySelector<HTMLAnchorElement>('a.stat-lead')!
    expect(stat.getAttribute('href')).toBe(`${href}?show=attention`)
    expect(stat.textContent).toBe('40%Tracks up to date2 / 53 need attention ›')
    expect(titles(container)).toHaveLength(5)
  })

  it('lists only the tracks that need attention there, with the way back to all', () => {
    const { container } = render(kind, 'attention')
    expect(titles(container)).toEqual(['Cellar', 'Tower', 'Roof'])
    const all = [...container.querySelectorAll('a')].find((a) => a.textContent === 'Show all')!
    expect(all.getAttribute('href')).toBe(href)
    expect(container.textContent).toContain('Showing the 3 tracks that need attention.')
  })
})

describe('the music the game no longer asks for', () => {
  const orphan: OrphanRow = {
    id: 'old-crypt',
    title: 'Old crypt',
    file: 'old-crypt.ogg',
    chosenAt: '2026-10-01T10:00:00.000Z',
    fileExists: true,
  }

  it('stacks in a narrow window, as the dropped effects do, so Remove is never off the edge', () => {
    const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')
    // Every rule inside a narrow-window media block (up to 700 px wide).
    const narrow = [...css.matchAll(/@media \(max-width: (\d+)px\) \{([\s\S]*?)\n\}\n/g)]
      .filter((m) => Number(m[1]) >= 600)
      .map((m) => m[2])
      .join('\n')
    const { container } = render('act', undefined, [orphan])
    const panel = container.querySelector('[aria-label="Music the game no longer asks for"]')!
    const table = panel.querySelector('table')!
    const stacking = [...table.classList].filter((c) =>
      new RegExp(`\\.${c}\\b[^{}]*\\{[^}]*display:\\s*block[^}]*min-width:\\s*0`).test(narrow),
    )
    expect(stacking).not.toEqual([])
  })
})
