import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { EffectsSummary } from '../../../core/effects'
import type { MusicListSummary, TrackRow } from '../../../core/music'
import type { ProjectSummary } from '../../../core/summary'
import type { ScenesRoute } from '../../route'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { summarizeScenes } = await import('../../../core/scenes')
const { ScenesView } = await import('./ScenesView')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterAll(() => {
  cleanups.forEach((c) => c())
  GlobalRegistrator.unregister()
})

// What the page asked the studio for, and what the next refresh answers.
const asked: { method: string; path: string }[] = []
let refreshAnswer: { status: number; body: unknown } = { status: 200, body: { ok: true } }
const gains: number[] = []
const loops: boolean[] = []
beforeEach(() => {
  asked.length = 0
  gains.length = 0
  loops.length = 0
  refreshAnswer = { status: 200, body: { ok: true } }
  globalThis.fetch = (async (path: string, init?: RequestInit) => {
    asked.push({ method: init?.method ?? 'GET', path })
    if (init?.method === 'POST') {
      return Response.json(refreshAnswer.body, { status: refreshAnswer.status })
    }
    return new Response(new ArrayBuffer(4))
  }) as unknown as typeof fetch
  ;(globalThis as { AudioContext?: unknown }).AudioContext = class {
    currentTime = 0
    destination = {}
    decodeAudioData = async () => ({ duration: 2 })
    createGain = () => {
      const gain = {
        gain: {
          set value(v: number) {
            gains.push(v)
          },
        },
        connect: (n: unknown) => n,
      }
      return gain
    }
    createBufferSource = () => {
      const source = {
        buffer: null,
        loop: false,
        onended: null,
        connect: (n: unknown) => n,
        start: () => loops.push(source.loop),
        stop: () => {},
      }
      return source
    }
  }
})

const take = { kind: 'take', take: 1, exists: true } as const
const track = (id: string, title: string, current: TrackRow['current'] = take) =>
  ({ id, title, current }) as TrackRow
const music: MusicListSummary[] = [
  {
    id: 'act1',
    kind: 'act',
    title: 'Act I: The Lantern',
    state: 'ok',
    tracks: [track('act1-store', 'General Store'), track('act1-forest', 'Forest Path')],
  } as MusicListSummary,
]
const row = (id: string, current: object = take, loops = false) => ({
  id,
  name: id,
  loops,
  current,
})
const effects = {
  status: 'ok',
  unreadable: 0,
  rows: [
    row('shop-bell'),
    row('glass-clink'),
    row('cat-purr', take, true),
    row('wolf-howl', { kind: 'nothing' }),
  ],
} as unknown as EffectsSummary

const store = {
  id: 'act1-store',
  name: 'General store',
  states: ['plain', 'cat-home'],
  triggers: ['door-opens'],
}
const forest = { id: 'act1-forest', name: 'Forest path', states: ['plain'], triggers: [] }
const chapel = { id: 'act1-chapel', name: 'Village chapel', states: [], triggers: ['bell-tolls'] }

function summary(state: 'ok' | 'missing' | 'invalid' = 'ok', canRefresh = true): ProjectSummary {
  const scenes = summarizeScenes({
    acts: [
      {
        id: 'act1',
        title: 'Act I: The Lantern',
        canRefresh,
        mixFile: 'game/scenes/act1.mix.json',
        declarations:
          state === 'ok'
            ? { status: 'ok', scenes: [store, forest, chapel], problems: [] }
            : state === 'missing'
              ? { status: 'missing' }
              : { status: 'invalid', problems: [] },
        mix: {
          status: 'ok',
          badIds: new Set(),
          scenes: {
            'act1-store': {
              music: { track: 'act1-store', level: 1 },
              effects: [
                { id: 'shop-bell', play: { mode: 'once', afterSeconds: 1.5 }, level: 0.6 },
                { id: 'glass-clink', play: { mode: 'random', everySeconds: [15, 30] }, level: 0.5 },
                { id: 'cat-purr', play: { mode: 'loop' }, state: 'cat-home', level: 1 },
                {
                  id: 'shop-bell',
                  play: { mode: 'trigger', trigger: 'door-opens' },
                  level: 2.5,
                },
              ],
            },
            'act1-forest': {
              music: { track: 'act1-forest', level: 0.8 },
              effects: [
                { id: 'wolf-howl', play: { mode: 'once', afterSeconds: 3 }, level: 0.9 },
                {
                  id: 'owl',
                  play: { mode: 'trigger', trigger: 'old-trigger' },
                  state: 'kit-trapped',
                  level: 0.7,
                },
              ],
            },
            'act1-chapel': { music: { track: null, level: 1 }, effects: [] },
          },
        },
      },
    ],
    effects,
    music,
  })
  return { scenes } as unknown as ProjectSummary
}

function render(route: ScenesRoute, shown: ProjectSummary = summary()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ScenesView, { summary: shown, route }),
      ),
    ),
  )
  return container
}

const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim()
const button = (page: HTMLElement, label: string) =>
  [...page.querySelectorAll('button')].find((b) => b.textContent === label)!
const flush = () => act(async () => {})
const open = { view: 'scenes', page: 'act', part: 'act1', scene: 'act1-store' } as const

describe('a project without scenes', () => {
  it('shows the box and the example', () => {
    const page = render({ view: 'scenes', page: null }, { scenes: null } as ProjectSummary)
    expect(text(page.querySelector('h1'))).toBe('Scenes')
    act(() => button(page, 'How to set it up').click())
    expect(page.querySelector('pre')?.textContent).toContain('"scenes": {')
  })
})

describe('an act with its scenes', () => {
  it('lists the scenes with what each has, the open one marked', () => {
    const page = render(open)
    expect(text(page.querySelector('.scene-list-count'))).toBe('3 scenes')
    const items = [...page.querySelectorAll('.scene-list li')]
    expect(items.map((li) => text(li))).toEqual([
      'General store4 effects',
      'Forest path1 gone',
      'Village chapelnone',
    ])
    expect(items[0]!.querySelector('a')!.getAttribute('aria-current')).toBe('page')
    expect(items[1]!.querySelector('.scene-count-red')).not.toBeNull()
    expect(items[0]!.querySelector('a')!.getAttribute('href')).toBe(
      '#/scenes/parts/act1?scene=act1-store',
    )
  })

  it('opens the first scene when the address names none, or one the act does not have', () => {
    expect(text(render({ view: 'scenes', page: null }).querySelector('h1'))).toBe('General store')
    expect(text(render({ ...open, scene: 'nope' }).querySelector('h1'))).toBe('General store')
  })

  it('writes the heading and the scene as words and numbers', () => {
    const page = render(open)
    expect(text(page.querySelector('.crumbs'))).toBe('Scenes · Act I')
    expect(text(page.querySelector('h1'))).toBe('General store')
    expect(text(page.querySelector('.page-header .muted'))).toBe(
      'States: plain, cat-home · Triggers: door-opens',
    )
    expect([...page.querySelectorAll('.page-header button')].map((b) => b.textContent)).toEqual([
      'Refresh from the game',
    ])
    expect(page.querySelector('input, [role=slider]')).toBeNull()
    expect(text(page.querySelector('[aria-label="Music"]'))).toBe('MusicGeneral Store100%')
    expect([...page.querySelectorAll('th')].map((th) => th.textContent)).toEqual([
      '',
      'Effect',
      'How it plays',
      'In which state',
      'Level',
    ])
    const rows = [...page.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].slice(1).map((td) => text(td)),
    )
    expect(rows).toEqual([
      ['shop-bell', 'Once, 1.5 s after entering', 'Always', '60%'],
      ['glass-clink', 'Now and then, every 15–30 s', 'Always', '50%'],
      ['cat-purr', 'Round and round', 'cat-home', '100%'],
      ['shop-bell', 'On a trigger: door-opens', 'Always', '250%'],
    ])
  })

  it('says a scene has no music and no effects', () => {
    const page = render({ ...open, scene: 'act1-chapel' })
    expect(text(page.querySelector('.page-header .muted'))).toBe(
      'States: none · Triggers: bell-tolls',
    )
    expect(text(page.querySelector('[aria-label="Music"]'))).toBe('MusicNo music')
    expect(page.querySelector('[aria-label="Music"] button')).toBeNull()
    expect(text(page.querySelector('[aria-label="Sound effects"]'))).toBe(
      'Sound effectsNo sound effects in this scene.',
    )
  })

  it('names the mix file when a scene cannot be read', () => {
    const shown = summary()
    shown.scenes!.acts[0]!.scenes[0]!.unreadable = true
    const page = render(open, shown)
    expect(text(page.querySelector('.scene-open'))).toContain('in game/scenes/act1.mix.json can')
  })

  it('says a scene has no states and no triggers', () => {
    const shown = summary()
    shown.scenes!.acts[0]!.scenes[2]!.triggers = []
    const page = render({ ...open, scene: 'act1-chapel' }, shown)
    expect(text(page.querySelector('.page-header .muted'))).toBe('No states · No triggers')
  })

  it('marks what the game no longer has, and the effect with no take chosen', () => {
    const page = render({ ...open, scene: 'act1-forest' })
    const rows = [...page.querySelectorAll('tbody tr')]
    const silent = rows[0]!
    expect(text(silent.querySelector('.scene-effect'))).toBe('wolf-howlno take chosen')
    expect(silent.querySelector('a.chip')!.getAttribute('href')).toBe('#/effects/items/wolf-howl')
    expect(silent.querySelector('button')).toBeNull()
    const gone = rows[1]!
    expect(text(gone.querySelector('.scene-effect'))).toBe('owlgone from the game')
    expect(text(gone.querySelector('.scene-how'))).toBe(
      'On a trigger: old-triggergone from the game',
    )
    expect(text(gone.querySelector('.scene-state'))).toBe('kit-trappedgone from the game')
    expect(gone.querySelector('button')).toBeNull()
  })
})

describe('playing a clip alone', () => {
  it('plays the music at its level, round and round, and stops on a second press', async () => {
    const page = render(open)
    const play = page.querySelector<HTMLButtonElement>('[aria-label="Music"] button')!
    expect(play.getAttribute('aria-label')).toBe('Play General Store')
    act(() => play.click())
    await flush()
    expect(asked.at(-1)).toEqual({ method: 'GET', path: '/api/music/tracks/act1-store/current' })
    expect(gains).toEqual([1])
    expect(loops).toEqual([true])
    expect(play.getAttribute('aria-label')).toBe('Stop General Store')
    act(() => play.click())
    expect(play.getAttribute('aria-label')).toBe('Play General Store')
  })

  it('plays an effect at its level, and stops the music', async () => {
    const page = render(open)
    const music = page.querySelector<HTMLButtonElement>('[aria-label="Music"] button')!
    act(() => music.click())
    await flush()
    const last = [...page.querySelectorAll<HTMLButtonElement>('tbody button')].at(-1)!
    act(() => last.click())
    await flush()
    expect(asked.at(-1)!.path).toBe('/api/effects/shop-bell/current')
    expect(gains.at(-1)).toBe(2.5)
    expect(loops.at(-1)).toBe(false)
    expect(music.getAttribute('aria-label')).toBe('Play General Store')
    expect(last.getAttribute('aria-label')).toBe('Stop shop-bell')
  })

  it('stops a clip when another scene is opened', async () => {
    const shown = summary()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, enabled: false } },
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    cleanups.push(() => act(() => root.unmount()))
    const show = (scene: string) =>
      act(() =>
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            createElement(ScenesView, { summary: shown, route: { ...open, scene } }),
          ),
        ),
      )
    show('act1-store')
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Music"] button')!.click())
    await flush()
    show('act1-forest')
    expect(container.querySelector('[aria-label="Music"] button')!.getAttribute('aria-label')).toBe(
      'Play Forest Path',
    )
  })

  it('loops an effect the game loops', async () => {
    const page = render(open)
    act(() => page.querySelectorAll<HTMLButtonElement>('tbody button')[2]!.click())
    await flush()
    expect(loops.at(-1)).toBe(true)
  })
})

describe('moving between scenes', () => {
  it('moves through the list with the arrow keys, the open scene the one Tab stops on', () => {
    const page = render(open)
    const links = [...page.querySelectorAll<HTMLAnchorElement>('.scene-list a')]
    expect(links.map((a) => a.tabIndex)).toEqual([0, -1, -1])
    links[0]!.focus()
    act(() => {
      links[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(document.activeElement).toBe(links[1]!)
  })

  it('has a menu of the scenes for a narrow window, showing the open one', () => {
    const page = render({ ...open, scene: 'act1-forest' })
    const menu = page.querySelector<HTMLSelectElement>('select')!
    expect(menu.value).toBe('act1-forest')
    expect([...menu.options].map((o) => o.textContent)).toEqual([
      'General store',
      'Forest path',
      'Village chapel',
    ])
  })
})

describe('the game has not listed the scenes', () => {
  it('says so, with a primary Refresh from the game and no list', () => {
    const page = render({ view: 'scenes', page: 'act', part: 'act1' }, summary('missing'))
    expect(text(page.querySelector('.scene-notice'))).toBe(
      "The game hasn't listed its scenes yet.Refresh from the game to read its scenes, their states and their triggers.Refresh from the game",
    )
    expect(button(page, 'Refresh from the game').className).toContain('btn-primary')
    expect(page.querySelector('.scene-list')).toBeNull()
  })

  it('has no button when the project names no command', () => {
    const page = render({ view: 'scenes', page: null }, summary('missing', false))
    expect(page.querySelector('button')).toBeNull()
  })

  it('says a list that cannot be read cannot, and can be refreshed', () => {
    const page = render({ view: 'scenes', page: null }, summary('invalid'))
    expect(text(page.querySelector('.scene-notice'))).toContain('cannot be read')
    expect(button(page, 'Refresh from the game')).toBeTruthy()
  })
})

describe('Refresh from the game', () => {
  it('asks the game for the act’s lists', async () => {
    const page = render(open)
    act(() => button(page, 'Refresh from the game').click())
    await flush()
    expect(asked).toContainEqual({ method: 'POST', path: '/api/parts/act1/refresh' })
    expect(page.querySelector('.scenes-failed')).toBeNull()
  })

  it('says it failed, keeps the scenes shown and shows what the command said', async () => {
    refreshAnswer = {
      status: 409,
      body: {
        ok: false,
        reason: 'failed',
        message: 'It failed',
        output: 'Cannot find module ./scenes',
      },
    }
    const page = render(open)
    act(() => button(page, 'Refresh from the game').click())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
    const failed = page.querySelector('.scenes-failed')!
    expect(text(failed)).toContain(
      'Refresh from the game failed.The scenes shown are from the last refresh.',
    )
    expect(text(failed.querySelector('pre'))).toBe('Cannot find module ./scenes')
    expect(text(page.querySelector('h1'))).toBe('General store')
    act(() => button(page, 'Close').click())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(page.querySelector('.scenes-failed')).toBeNull()
  })
})
