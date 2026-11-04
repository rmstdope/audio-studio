import { afterAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { MusicListSummary, OrphanRow, TrackRow } from '../../../core/music'
import type { TrackStatus } from '../../../core/musicChoose'
import type { ProjectSummary } from '../../../core/summary'
import type { MusicRoute } from '../../route'
import { minWidthsInEveryWindow } from '../../../../test/stylesheet'

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
  canRefresh: true,
})

/** A list page's play buttons, by track title. */
function render(
  kind: MusicListSummary['kind'],
  show?: 'attention',
  orphans: OrphanRow[] = [],
  making: Record<string, unknown> = {},
) {
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  })
  client.setQueryData(['music-making'], making)
  client.setQueryData(['music-model-state'], {
    ok: true,
    model: 'balanced',
    ready: true,
    message: null,
  })
  act(() =>
    root.render(
      createElement(QueryClientProvider, { client }, createElement(MusicView, { summary, route })),
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
    expect(stat.textContent).toBe(
      `40%${kind === 'act' ? 'Tracks' : 'Stingers'} up to date2 / 53 need attention ›`,
    )
    expect(titles(container)).toHaveLength(5)
  })

  it('lists only the tracks that need attention there, with the way back to all', () => {
    const { container } = render(kind, 'attention')
    expect(titles(container)).toEqual(['Cellar', 'Tower', 'Roof'])
    const all = [...container.querySelectorAll('a')].find((a) => a.textContent === 'Show all')!
    expect(all.getAttribute('href')).toBe(href)
    expect(container.textContent).toContain(
      `Showing the 3 ${kind === 'act' ? 'tracks' : 'stingers'} that need attention.`,
    )
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
    // Every rule that applies in a 600 px window: those in media blocks of 600 px wide or more.
    const narrow = [...css.matchAll(/@media \(max-width: (\d+)px\) \{([\s\S]*?)\n\}\n/g)]
      .filter((m) => Number(m[1]) >= 600)
      .map((m) => m[2])
      .join('\n')
    const { container } = render('act', undefined, [orphan])
    const panel = container.querySelector('[aria-label="Music the game no longer asks for"]')!
    const table = panel.querySelector('table')!
    // The table element itself, by a bare class in a selector list, must lose its minimum width.
    const stacking = [...table.classList].filter((c) =>
      new RegExp(
        `(?:^|[\\s,])\\.${c}\\s*(?:,[^{}]*)?\\{[^}]*display:\\s*block[^}]*min-width:\\s*0`,
      ).test(narrow),
    )
    expect(stacking).not.toEqual([])
  })

  it('holds no minimum width in any window, so it never scrolls the page and Remove stays in the panel', () => {
    const { container } = render('act', undefined, [orphan])
    const panel = container.querySelector('[aria-label="Music the game no longer asks for"]')!
    const table = panel.querySelector('table')!
    expect(table.closest('.table-box')).toBeNull()
    expect(minWidthsInEveryWindow(table)).toEqual([])
  })
})

describe('a track’s status while takes are made', () => {
  it('says what is being made, but not for a track whose takes only failed', () => {
    const { container } = render('act', undefined, [], {
      roof: { takes: 2, left: 120, failed: 0 },
      cellar: { takes: 0, left: 0, failed: 1 },
    })
    const status = (title: string) =>
      [...container.querySelectorAll('tbody tr')]
        .find((tr) => tr.textContent!.includes(title))!
        .querySelector('td:last-child')!.textContent
    expect(status('Roof')).toBe('making 2 takes · about 2 min')
    expect(status('Cellar')).toBe('changed since chosen')
  })
})

describe('the words of the page', () => {
  it('says stinger throughout on the Stingers page and track on an act page', () => {
    const stingers = render('stingers').container
    expect(stingers.querySelector('section[aria-label="Stingers up to date"]')).not.toBeNull()
    expect(stingers.querySelector('a.stat-lead')!.textContent).toContain('Stingers up to date')
    expect([...stingers.querySelectorAll('th')].map((h) => h.textContent)).toContain('Stinger')
    expect(stingers.textContent).not.toContain('Tracks up to date')
    expect(stingers.textContent).toContain('1 stinger has no chosen take')
    const act = render('act').container
    expect(act.querySelector('section[aria-label="Tracks up to date"]')).not.toBeNull()
    expect([...act.querySelectorAll('th')].map((h) => h.textContent)).toContain('Track')
    expect(act.textContent).toContain('1 track has no chosen take')
  })

  it('counts the whole page while it is filtered to what needs attention', () => {
    const { container } = render('stingers', 'attention')
    expect(container.textContent).toContain('1 stinger has no chosen take')
    expect(container.textContent).toContain('40%Stingers up to date')
  })
})

describe('Refresh from the game while takes are made', () => {
  const refresh = (container: HTMLElement) =>
    [...container.querySelectorAll('button')].find((b) =>
      b.textContent!.startsWith('Refresh'),
    ) as HTMLButtonElement

  it('is greyed with its reason while a stinger is making takes, and open otherwise', () => {
    const idle = render('stingers').container
    expect(refresh(idle).getAttribute('aria-disabled')).toBeNull()
    expect(refresh(idle).title).toBe('')
    const busy = render('stingers', undefined, [], { roof: { takes: 2, left: 60, failed: 0 } })
    const button = refresh(busy.container)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.title).toBe(
      'Takes are being made for the stingers. Refresh when they are done, or Stop all.',
    )
    expect(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent).toBe(
      button.title,
    )
  })

  it('is never greyed on an act page', () => {
    const { container } = render('act', undefined, [], { roof: { takes: 2, left: 60, failed: 0 } })
    expect(refresh(container).getAttribute('aria-disabled')).toBeNull()
  })

  it('greys Make 4 takes each while the stingers refresh runs', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch
    try {
      const { container } = render('stingers')
      await act(async () => {
        refresh(container).click()
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
      expect(refresh(container).textContent).toBe('Refreshing from the game…')
      const make = [...container.querySelectorAll('button')].find(
        (b) => b.textContent === 'Make 4 takes each',
      )!
      expect(make.getAttribute('aria-disabled')).toBe('true')
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
