import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { EffectsSummary } from '../../../core/effects'
import type { MusicListSummary, TrackRow } from '../../../core/music'
import { scaleMix, type SceneKept, type SceneMeasure } from '../../../core/sceneLoudness'
import type { SceneMix } from '../../../core/scenes'
import type { ProjectSummary } from '../../../core/summary'
import { fakeHistory } from '../../../../test/fakeHistory'
import { useRoute, type ScenesRoute } from '../../route'

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
// What was saved, what the next save answers, and (when set) a gate the answer waits for.
const puts: {
  path: string
  body: { scene: SceneMix; was: SceneMix | null; moved?: { db: number; measuredAt: string } }
}[] = []
let saveAnswer: { status: number; body: unknown } = { status: 200, body: { ok: true } }
let saveGate: Promise<void> | null = null
const gains: number[] = []
let measureAnswer: { status: number; body: unknown } = { status: 200, body: { ok: true } }
const measures: { path: string; body: { open?: { scene: string; entry: SceneMix } } }[] = []
const loops: boolean[] = []
// A page left mounted would go on guarding its unsaved changes in the next test.
afterEach(async () => {
  // Let a queued hashchange (a page going on to another scene) land while the DOM is still there.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
  cleanups.splice(0).forEach((c) => c())
  document.body.innerHTML = ''
  window.history.replaceState(null, '', '#')
})
beforeEach(() => {
  asked.length = 0
  gains.length = 0
  loops.length = 0
  refreshAnswer = { status: 200, body: { ok: true } }
  puts.length = 0
  measures.length = 0
  measureAnswer = { status: 200, body: { ok: true } }
  saveAnswer = { status: 200, body: { ok: true } }
  saveGate = null
  globalThis.fetch = (async (path: string, init?: RequestInit) => {
    asked.push({ method: init?.method ?? 'GET', path })
    if (init?.method === 'PUT') {
      puts.push({ path, body: JSON.parse(init.body as string) })
      await saveGate
      return Response.json(saveAnswer.body, { status: saveAnswer.status })
    }
    if (init?.method === 'POST' && path.startsWith('/api/scene-loudness')) {
      measures.push({ path, body: JSON.parse(init.body as string) })
      return Response.json(measureAnswer.body, { status: measureAnswer.status })
    }
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

function summary(
  state: 'ok' | 'missing' | 'invalid' = 'ok',
  canRefresh = true,
  kept: {
    loudness?: Record<string, SceneKept>
    target?: { target: number; tolerance: number } | null
    /** The level of the store's door-opens effect (250% by default). */
    triggerLevel?: number
    /** The store's mix, instead of the fixture's. */
    storeMix?: SceneMix
  } = {},
): ProjectSummary {
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
        loudness: kept.loudness,
        mix: {
          status: 'ok',
          badIds: new Set(),
          scenes: {
            'act1-store': kept.storeMix ?? {
              music: { track: 'act1-store', level: 1 },
              effects: [
                { id: 'shop-bell', play: { mode: 'once', afterSeconds: 1.5 }, level: 0.6 },
                { id: 'glass-clink', play: { mode: 'random', everySeconds: [15, 30] }, level: 0.5 },
                { id: 'cat-purr', play: { mode: 'loop' }, state: 'cat-home', level: 1 },
                {
                  id: 'shop-bell',
                  play: { mode: 'trigger', trigger: 'door-opens' },
                  level: kept.triggerLevel ?? 2.5,
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
    target: kept.target ?? null,
  })
  return { scenes } as unknown as ProjectSummary
}

function render(
  route: ScenesRoute,
  shown: ProjectSummary = summary(),
  making: Record<string, { done: number; total: number }> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(['scene-loudness'], making)
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

function renderLive(route: ScenesRoute, first: ProjectSummary) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  const show = (shown: ProjectSummary, at: ScenesRoute = route) =>
    act(() =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(ScenesView, { summary: shown, route: at }),
        ),
      ),
    )
  show(first)
  return { page: container, show }
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
      'Discard',
      'Save',
      'Refresh from the game',
    ])
    expect(text(page.querySelector('.scene-status'))).toBeUndefined()
    expect(text(page.querySelector('[aria-label="Music"]'))).toBe('MusicGeneral Store100%MS')
    expect(page.querySelector<HTMLInputElement>('[aria-label="Music level"]')!.value).toBe('100')
    expect([...page.querySelectorAll('th')].map((th) => th.textContent)).toEqual([
      '',
      'Effect',
      'How it plays',
      'In which state',
      'Level',
      '',
      '',
    ])
    const rows = [...page.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td:not(.scene-now-idle)')].slice(1, 5).map((td) => text(td)),
    )
    expect(rows).toEqual([
      ['shop-bell', 'Once s after entering', 'Always', '60%'],
      ['glass-clink', 'Now and thenevery – s', 'Always', '50%'],
      ['cat-purr', 'Round and round', 'cat-home', '100%'],
      ['shop-bell', 'On a triggerdoor-opens', 'Always', '250%'],
    ])
    const boxes = [...page.querySelectorAll<HTMLInputElement>('.scene-num')].map((i) => i.value)
    expect(boxes).toEqual(['1.5', '15', '30'])
  })

  it('says a scene has no music and no effects', () => {
    const page = render({ ...open, scene: 'act1-chapel' })
    expect(text(page.querySelector('.page-header .muted'))).toBe(
      'States: none · Triggers: bell-tolls',
    )
    expect(text(page.querySelector('[aria-label="Music"]'))).toBe('MusicNo music')
    expect(page.querySelector('[aria-label^="Play"]')).toBeNull()
    expect(page.querySelector('[aria-label="Music level"]')).toBeNull()
    expect(text(page.querySelector('[aria-label="Sound effects"]'))).toBe(
      'Sound effectsNo sound effects in this scene.+ Add a sound effect',
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
    expect(silent.querySelector('[aria-label^="Play"]')).toBeNull()
    const gone = rows[1]!
    expect(text(gone.querySelector('.scene-effect'))).toBe('owlgone from the game')
    expect(text(gone.querySelector('.scene-how'))).toBe('On a triggerold-triggergone from the game')
    expect(text(gone.querySelector('.scene-state'))).toBe('kit-trappedgone from the game')
    expect(gone.querySelector('.scene-how .menu-gone')).not.toBeNull()
    expect(gone.querySelector('[aria-label^="Play"]')).toBeNull()
    expect(gone.querySelector('[aria-label="Remove"]')).not.toBeNull()
  })

  it('keeps the whole effect name as text and shows it on hover, beside the mark', () => {
    const page = render({ ...open, scene: 'act1-forest' })
    const gone = [...page.querySelectorAll('tbody tr')][1]!
    const name = gone.querySelector('.scene-effect .scene-effect-name') as HTMLElement
    expect(name.textContent).toBe('owl')
    expect(name.title).toBe('owl')
    expect(gone.querySelector('.scene-effect-cell .chip-danger')).not.toBeNull()
    const silent = [...page.querySelectorAll('tbody tr')][0]!
    expect(silent.querySelector('.scene-effect-cell a.chip')).not.toBeNull()
  })
})

describe('playing a clip alone', () => {
  it('plays the music at its level, round and round, and stops on a second press', async () => {
    const page = render(open)
    const play = page.querySelector<HTMLButtonElement>('[aria-label="Music"] .icon-btn')!
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
    const music = page.querySelector<HTMLButtonElement>('[aria-label="Music"] .icon-btn')!
    act(() => music.click())
    await flush()
    const last = [...page.querySelectorAll<HTMLButtonElement>('tbody [aria-label^="Play"]')].at(-1)!
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
    act(() => container.querySelector<HTMLButtonElement>('[aria-label^="Play"]')!.click())
    await flush()
    show('act1-forest')
    expect(container.querySelector('[aria-label$="Forest Path"]')!.getAttribute('aria-label')).toBe(
      'Play Forest Path',
    )
  })

  it('loops an effect the game loops', async () => {
    const page = render(open)
    act(() => page.querySelectorAll<HTMLButtonElement>('tbody [aria-label^="Play"]')[2]!.click())
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

// Editing: the page changes the scene in itself and saves it when asked.
const type = (input: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
const menu = (page: HTMLElement, label: string, row = 0) =>
  page.querySelectorAll<HTMLButtonElement>(`[aria-haspopup="listbox"][aria-label^="${label}:"]`)[
    row
  ]!
const choose = (trigger: HTMLButtonElement, option: string) => {
  act(() => trigger.click())
  const found = [...trigger.parentElement!.querySelectorAll<HTMLElement>('[role=option]')].find(
    (o) => o.textContent === option,
  )
  if (!found) throw new Error(`no option ${option}`)
  act(() => found.click())
}
const status = (page: HTMLElement) => text(page.querySelector('.scene-status'))
const rows = (page: HTMLElement) => [...page.querySelectorAll('tbody tr')]
const musicLevel = (page: HTMLElement) =>
  page.querySelector<HTMLInputElement>('[aria-label="Music level"]')!

describe('editing a scene', () => {
  it('starts untouched: Save and Discard dimmed, no status word, no dot', () => {
    const page = render(open)
    expect(button(page, 'Save').getAttribute('aria-disabled')).toBe('true')
    expect(button(page, 'Discard').getAttribute('aria-disabled')).toBe('true')
    expect(status(page)).toBeUndefined()
    expect(page.querySelector('.scene-dot')).toBeNull()
  })

  it('says Unsaved changes at the first change, with a dot in the list, and Discard puts it back', () => {
    const page = render(open)
    type(musicLevel(page), '40')
    expect(status(page)).toBe('Unsaved changes')
    expect(button(page, 'Save').getAttribute('aria-disabled')).toBeNull()
    expect(button(page, 'Discard').getAttribute('aria-disabled')).toBeNull()
    expect(text(page.querySelector('.scene-list li'))).toContain('●')
    expect(text(page.querySelector('.scene-music'))).toContain('40%')
    act(() => button(page, 'Discard').click())
    expect(status(page)).toBeUndefined()
    expect(musicLevel(page).value).toBe('100')
    expect(page.querySelector('.scene-dot')).toBeNull()
  })

  it('moves a level with the slider, 0 to 300 in steps of 5', () => {
    const page = render(open)
    const slider = musicLevel(page)
    expect([slider.min, slider.max, slider.step]).toEqual(['0', '300', '5'])
    type(page.querySelector<HTMLInputElement>('[aria-label="Level of shop-bell"]')!, '300')
    expect(text(rows(page)[0]!.querySelector('.scene-level'))).toBe('300%')
  })

  it('hears a level moved while the clip plays, at once', async () => {
    const page = render(open)
    act(() => page.querySelector<HTMLButtonElement>('[aria-label="Music"] .icon-btn')!.click())
    await flush()
    type(musicLevel(page), '150')
    expect(gains.at(-1)).toBe(1.5)
  })

  it('chooses the music from the act’s tracks, or none (which hides the level)', () => {
    const page = render(open)
    const trigger = menu(page, 'Music')
    expect([...page.querySelectorAll('[role=option]')]).toEqual([])
    act(() => trigger.click())
    expect(
      [...trigger.parentElement!.querySelectorAll('[role=option]')].map((o) => o.textContent),
    ).toEqual(['No music', 'General Store', 'Forest Path'])
    act(() => trigger.click())
    choose(menu(page, 'Music'), 'Forest Path')
    expect(menu(page, 'Music').textContent).toBe('Forest Path')
    expect(page.querySelector('[aria-label="Play Forest Path"]')).not.toBeNull()
    choose(menu(page, 'Music'), 'No music')
    expect(menu(page, 'Music').textContent).toBe('No music')
    expect(page.querySelector('[aria-label="Music level"]')).toBeNull()
    expect(status(page)).toBe('Unsaved changes')
  })

  it('says why a track plays nothing, and follows the chosen track', () => {
    const shown = summary()
    const tracks = shown.scenes!.acts[0]!.tracks
    const set = (id: string, playable: boolean, problem: (typeof tracks)[number]['problem']) =>
      Object.assign(
        tracks.find((t) => t.id === id)!,
        { playable, problem },
      )
    set('act1-store', false, { kind: 'file', file: 'game/village-lane.wav' })
    set('act1-forest', false, { kind: 'nothing' })
    const page = render(open, shown)
    const chip = page.querySelector<HTMLAnchorElement>('[aria-label="Music"] a.chip')!
    expect(chip.textContent).toBe('file not there')
    expect(chip.className).toContain('chip-danger')
    expect(chip.title).toBe("The game's file village-lane.wav is not there.")
    expect(chip.getAttribute('href')).toBe('#/music/tracks/act1-store')
    expect(page.querySelector('[aria-label="Music"] .icon-btn')).toBeNull()
    choose(menu(page, 'Music'), 'Forest Path')
    const amber = page.querySelector<HTMLAnchorElement>('[aria-label="Music"] a.chip')!
    expect(amber.textContent).toBe('no take chosen')
    expect(amber.className).toContain('chip-warn')
    expect(amber.getAttribute('href')).toBe('#/music/tracks/act1-forest')
    choose(menu(page, 'Music'), 'No music')
    expect(page.querySelector('[aria-label="Music"] a.chip')).toBeNull()
  })

  it('reads the reason from the music list: a missing game file gets the chip, a present one the ▶', () => {
    const store = music[0]!.tracks[0]!
    const before = store.current
    try {
      store.current = { kind: 'game', file: 'game/village-lane.wav', exists: false }
      const missing = render(open)
      expect(missing.querySelector('[aria-label="Music"] a.chip')!.getAttribute('title')).toBe(
        "The game's file village-lane.wav is not there.",
      )
      expect(missing.querySelector('[aria-label="Music"] .icon-btn')).toBeNull()
      store.current = { kind: 'game', file: 'game/village-lane.wav', exists: true }
      const there = render(open)
      expect(there.querySelector('[aria-label="Music"] a.chip')).toBeNull()
      expect(there.querySelector('[aria-label="Music"] .icon-btn')).not.toBeNull()
    } finally {
      store.current = before
    }
  })

  it('shows no reason for a track that plays', () => {
    const page = render(open)
    expect(page.querySelector('[aria-label="Music"] a.chip')).toBeNull()
  })

  it('removes an effect, and focus goes to the next ✕, or to Add after the last', () => {
    const page = render(open)
    act(() => page.querySelectorAll<HTMLButtonElement>('button[aria-label="Remove"]')[1]!.click())
    expect(rows(page).map((r) => text(r.querySelector('.scene-effect')))).toEqual([
      'shop-bell',
      'cat-purr',
      'shop-bell',
    ])
    expect(document.activeElement).toBe(rows(page)[1]!.querySelector('[data-remove]'))
    act(() => rows(page)[2]!.querySelector<HTMLButtonElement>('[data-remove]')!.click())
    expect(document.activeElement).toBe(page.querySelector('[data-add]'))
    expect(status(page)).toBe('Unsaved changes')
  })

  it('changes how an effect plays and keeps what was typed when switching back', () => {
    const page = render(open)
    choose(menu(page, 'How it plays', 1), 'Once')
    expect(rows(page)[1]!.querySelector<HTMLInputElement>('.scene-num')!.value).toBe('0')
    choose(menu(page, 'How it plays', 1), 'Now and then')
    const [first, second] = rows(page)[1]!.querySelectorAll<HTMLInputElement>('.scene-num')
    expect([first!.value, second!.value]).toEqual(['15', '30'])
    type(first!, '3')
    choose(menu(page, 'How it plays', 1), 'Once')
    choose(menu(page, 'How it plays', 1), 'Now and then')
    expect(rows(page)[1]!.querySelector<HTMLInputElement>('.scene-num')!.value).toBe('3')
    choose(menu(page, 'How it plays', 1), 'On a trigger')
    expect(menu(page, 'Trigger').textContent).toBe('door-opens')
  })

  it('offers On a trigger only when the scene has triggers', () => {
    const page = render({ ...open, scene: 'act1-forest' })
    act(() => menu(page, 'How it plays').click())
    const options = [...page.querySelectorAll('[role=option]')].map((o) => o.textContent)
    expect(options).toEqual(['Round and round', 'Now and then', 'Once'])
  })

  it('chooses the state from Always and the scene’s states; no states, plain Always', () => {
    const page = render(open)
    choose(menu(page, 'In which state', 0), 'cat-home')
    expect(menu(page, 'In which state', 0).textContent).toBe('cat-home')
    const chapel = render({ ...open, scene: 'act1-chapel' })
    expect(chapel.querySelector('[aria-label^="In which state"]')).toBeNull()
  })

  it('flags a number that cannot work on its row, blocks Save and counts the red rows', async () => {
    const page = render(open)
    const second = rows(page)[1]!.querySelectorAll<HTMLInputElement>('.scene-num')[1]!
    type(second, '900')
    expect(text(rows(page)[1]!.querySelector('.scene-error'))).toBe('At most 600 seconds.')
    expect(second.getAttribute('aria-invalid')).toBe('true')
    expect(second.getAttribute('aria-describedby')).toBe(
      rows(page)[1]!.querySelector('.scene-error')!.id,
    )
    expect(status(page)).toBe('Fix the 1 red row to save')
    expect(page.querySelector('.scene-status-red')).not.toBeNull()
    expect(button(page, 'Save').getAttribute('aria-disabled')).toBe('true')
    act(() => button(page, 'Save').click())
    await flush()
    expect(puts).toEqual([])
    expect(button(page, 'Discard').getAttribute('aria-disabled')).toBeNull()
    type(rows(page)[0]!.querySelector<HTMLInputElement>('.scene-num')!, '')
    expect(status(page)).toBe('Fix the 2 red rows to save')
    expect(text(rows(page)[0]!.querySelector('.scene-error'))).toBe('Type a number of seconds.')
    type(second, '40')
    type(rows(page)[0]!.querySelector<HTMLInputElement>('.scene-num')!, '2')
    expect(status(page)).toBe('Unsaved changes')
    expect(page.querySelector('.scene-error')).toBeNull()
  })

  it('turns both boxes red when the first number is not smaller than the second', () => {
    const page = render(open)
    const [first, second] = rows(page)[1]!.querySelectorAll<HTMLInputElement>('.scene-num')
    type(first!, '30')
    expect([first!, second!].map((i) => i.getAttribute('aria-invalid'))).toEqual(['true', 'true'])
    expect(text(rows(page)[1]!.querySelector('.scene-error'))).toBe(
      'The first number must be smaller than the second.',
    )
  })

  it('Discard still works while rows are red', () => {
    const page = render(open)
    type(rows(page)[0]!.querySelector<HTMLInputElement>('.scene-num')!, 'abc')
    act(() => button(page, 'Discard').click())
    expect(page.querySelector('.scene-error')).toBeNull()
    expect(status(page)).toBeUndefined()
  })

  it('saves the scene for the game: Saving…, then Saved, focus staying on Save', async () => {
    let release = () => {}
    saveGate = new Promise((resolve) => (release = resolve))
    const page = render(open)
    type(musicLevel(page), '40')
    button(page, 'Save').focus()
    act(() => button(page, 'Save').click())
    await flush()
    expect(puts.map((p) => p.path)).toEqual(['/api/scenes/act1/act1-store'])
    expect(puts[0]!.body.scene.music).toEqual({ track: 'act1-store', level: 0.4 })
    expect(puts[0]!.body.scene.effects[0]).toEqual({
      id: 'shop-bell',
      play: { mode: 'once', afterSeconds: 1.5 },
      level: 0.6,
    })
    expect(puts[0]!.body.was?.music).toEqual({ track: 'act1-store', level: 1 })
    expect(button(page, 'Saving…').getAttribute('aria-disabled')).toBe('true')
    await act(async () => release())
    expect(status(page)).toBe('Saved')
    expect(page.querySelector('.scene-status-ok')).not.toBeNull()
    expect(button(page, 'Save').getAttribute('aria-disabled')).toBe('true')
    expect(page.querySelector('.scene-dot')).toBeNull()
    expect(document.activeElement).toBe(button(page, 'Save'))
    type(musicLevel(page), '50')
    expect(status(page)).toBe('Unsaved changes')
  })

  it('writes a number typed with a decimal as a number', async () => {
    const page = render(open)
    type(rows(page)[0]!.querySelector<HTMLInputElement>('.scene-num')!, '2.25')
    act(() => button(page, 'Save').click())
    await flush()
    expect(puts[0]!.body.scene.effects[0]?.play).toEqual({ mode: 'once', afterSeconds: 2.25 })
  })

  it('says it could not save, keeping the changes', async () => {
    saveAnswer = { status: 409, body: { ok: false, kind: 'failed', message: 'the disk is full' } }
    const page = render(open)
    type(musicLevel(page), '40')
    act(() => button(page, 'Save').click())
    await flush()
    const panel = page.querySelector('[aria-label="Save failed"]')!
    expect(text(panel)).toBe(
      "Couldn't save General store.Your changes are still here; try Save again.the disk is full",
    )
    expect(status(page)).toBe('Unsaved changes')
    expect(musicLevel(page).value).toBe('40')
  })

  it('offers to keep mine or load the saved one when the scene was saved elsewhere', async () => {
    const current = { music: { track: 'act1-store', level: 2 }, effects: [] }
    saveAnswer = { status: 409, body: { ok: false, kind: 'stale', current } }
    const page = render(open)
    type(musicLevel(page), '40')
    act(() => button(page, 'Save').click())
    await flush()
    const panel = page.querySelector('[aria-label="Saved somewhere else"]')!
    expect(text(panel)).toBe(
      'General store was saved somewhere else since you opened it.Your changes are still here. Keep yours to save over it, or load the saved one and lose yours.Keep mine and saveLoad the saved one',
    )
    expect(document.activeElement).toBe(button(page, 'Keep mine and save'))
    expect(musicLevel(page).value).toBe('40')
    saveAnswer = { status: 200, body: { ok: true } }
    act(() => button(page, 'Keep mine and save').click())
    await flush()
    expect(puts[1]!.body.was).toEqual(current)
    expect(puts[1]!.body.scene.music?.level).toBe(0.4)
    expect(page.querySelector('[aria-label="Saved somewhere else"]')).toBeNull()
    expect(status(page)).toBe('Saved')
    expect(document.activeElement).toBe(button(page, 'Save'))
  })

  it('loses the draft for the saved scene when asked', async () => {
    saveAnswer = { status: 409, body: { ok: false, kind: 'stale', current: null } }
    const page = render(open)
    type(musicLevel(page), '40')
    act(() => button(page, 'Save').click())
    await flush()
    act(() => button(page, 'Load the saved one').click())
    await flush()
    expect(page.querySelector('[aria-label="Saved somewhere else"]')).toBeNull()
    expect(status(page)).toBeUndefined()
    expect(page.querySelector('.scene-dot')).toBeNull()
    expect(musicLevel(page).value).toBe('100')
    expect(document.activeElement).toBe(button(page, 'Save'))
  })
})

describe('adding a sound effect', () => {
  const add = (page: HTMLElement) => button(page, '+ Add a sound effect')
  const find = (page: HTMLElement) =>
    page.querySelector<HTMLInputElement>('[aria-label="Find a sound effect…"]')!

  it('lists the game’s effects with loop and no take chosen, narrowing as you type', () => {
    const page = render(open)
    act(() => add(page).click())
    const list = () =>
      [...page.querySelectorAll('.scene-add-list li')].map((li) =>
        text(li.querySelector('.menu-option')),
      )
    expect(list()).toEqual(['shop-bell', 'glass-clink', 'cat-purrloop', 'wolf-howlno take chosen'])
    expect(page.querySelectorAll('.scene-add-list li [aria-label^="Play"]').length).toBe(3)
    type(find(page), 'PURR')
    expect(list()).toEqual(['cat-purrloop'])
  })

  it('adds a loop as Round and round, and a one-shot as Now and then every 10–20 s, at 100%', () => {
    const page = render({ ...open, scene: 'act1-chapel' })
    act(() => add(page).click())
    act(() => page.querySelector<HTMLElement>('.scene-add-list .menu-option')!.click())
    act(() => add(page).click())
    type(find(page), 'purr')
    act(() => page.querySelector<HTMLElement>('.scene-add-list .menu-option')!.click())
    expect(rows(page).map((r) => text(r.querySelector('.scene-how')))).toEqual([
      'Now and thenevery – s',
      'Round and round',
    ])
    expect([...page.querySelectorAll<HTMLInputElement>('.scene-num')].map((i) => i.value)).toEqual([
      '10',
      '20',
    ])
    expect(rows(page).map((r) => text(r.querySelector('.scene-level')))).toEqual(['100%', '100%'])
    expect(rows(page).map((r) => text(r.querySelector('.scene-state')))).toEqual([
      'Always',
      'Always',
    ])
    expect(status(page)).toBe('Unsaved changes')
    expect(page.querySelector('.scene-add-list')).toBeNull()
  })

  it('adds the same effect twice', () => {
    const page = render(open)
    for (let i = 0; i < 2; i++) {
      act(() => add(page).click())
      act(() => page.querySelector<HTMLElement>('.scene-add-list .menu-option')!.click())
    }
    expect(rows(page).length).toBe(6)
  })

  it('lists every effect with no filter typed, and no "more…" line', () => {
    const shown = summary()
    for (let i = 0; i < 9; i++) {
      shown.scenes!.effects.push({
        id: `extra-${i}`,
        name: `extra-${i}`,
        loops: false,
        silent: false,
        playable: true,
        clip: null,
      })
    }
    const page = render(open, shown)
    act(() => add(page).click())
    expect(page.querySelectorAll('.scene-add-list li').length).toBe(13)
    expect(page.querySelector('.scene-add-list .muted')).toBeNull()
  })

  describe('placement', () => {
    // happy-dom lays nothing out: say where the button is and how tall the menu would be.
    const layout = { buttonTop: 400, buttonBottom: 430, height: 300, window: 800 }
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>
    const saved = {
      rect: proto.getBoundingClientRect,
      offsetHeight: Object.getOwnPropertyDescriptor(proto, 'offsetHeight'),
      innerHeight: window.innerHeight,
    }
    beforeEach(() => {
      proto.getBoundingClientRect = function (this: HTMLElement) {
        const top = this.hasAttribute('data-add') ? layout.buttonTop : 0
        const bottom = this.hasAttribute('data-add') ? layout.buttonBottom : 0
        return {
          top,
          bottom,
          left: 0,
          right: 0,
          width: 0,
          height: bottom - top,
          x: 0,
          y: top,
        } as DOMRect
      }
      Object.defineProperty(proto, 'offsetHeight', {
        configurable: true,
        get(this: HTMLElement) {
          if (this.classList.contains('scene-add-list')) return layout.height
          return this.tagName === 'UL' && this.parentElement?.classList.contains('scene-add-list')
            ? layout.height - 50
            : 0
        },
      })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: layout.window })
    })
    afterEach(() => {
      proto.getBoundingClientRect = saved.rect
      if (saved.offsetHeight) Object.defineProperty(proto, 'offsetHeight', saved.offsetHeight)
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: saved.innerHeight })
      Object.assign(layout, { buttonTop: 400, buttonBottom: 430, height: 300, window: 800 })
    })
    const menu = (page: HTMLElement) => page.querySelector<HTMLElement>('.scene-add-list')!

    it('opens below when the whole menu fits under the button', () => {
      const page = render(open)
      act(() => add(page).click())
      expect(menu(page).classList.contains('scene-add-up')).toBe(false)
    })

    it('opens above when it does not fit below but fits above', () => {
      layout.buttonTop = 700
      layout.buttonBottom = 730
      const page = render(open)
      act(() => add(page).click())
      expect(menu(page).classList.contains('scene-add-up')).toBe(true)
      expect(page.querySelector<HTMLElement>('.scene-add-list ul')!.style.maxHeight).toBe('')
    })

    it('opens on the side with more room, with a shorter list, when neither fits', () => {
      layout.window = 400
      layout.buttonTop = 250
      layout.buttonBottom = 280
      layout.height = 500
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 })
      const page = render(open)
      act(() => add(page).click())
      // 246 px above, 116 below; the menu is 500 tall, so the list gives up 254 px.
      expect(menu(page).classList.contains('scene-add-up')).toBe(true)
      const list = page.querySelector<HTMLElement>('.scene-add-list ul')!
      expect(list.style.maxHeight).toBe('196px') // 450 - (500 - 246)
    })

    it('keeps its side while you type', () => {
      layout.buttonTop = 700
      layout.buttonBottom = 730
      const page = render(open)
      act(() => add(page).click())
      layout.height = 40 // under the 66 px below: only keeping the side explains 'above'
      type(find(page), 'purr')
      expect(menu(page).classList.contains('scene-add-up')).toBe(true)
    })

    it('reopens, after a click outside, on the side that fits every effect', () => {
      // As tall as what it lists: 40 px a line, plus the find box.
      Object.defineProperty(proto, 'offsetHeight', {
        configurable: true,
        get(this: HTMLElement) {
          const lines = this.querySelectorAll('li').length * 40
          if (this.classList.contains('scene-add-list')) return lines + 50
          return this.tagName === 'UL' ? lines : 0
        },
      })
      layout.buttonTop = 520
      layout.buttonBottom = 550
      // 196 px below: one effect (90 px) fits there, all four (210 px) only above.
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 750 })
      const page = render(open)
      act(() => add(page).click())
      type(find(page), 'purr')
      act(() => {
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      })
      act(() => add(page).click())
      expect(menu(page).classList.contains('scene-add-up')).toBe(true)
    })

    it('is placed again when the window is resized', () => {
      const page = render(open)
      act(() => add(page).click())
      expect(menu(page).classList.contains('scene-add-up')).toBe(false)
      layout.window = 500
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 })
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })
      expect(menu(page).classList.contains('scene-add-up')).toBe(true)
    })

    it('ignores the list scrolling inside the menu', () => {
      const page = render(open)
      act(() => add(page).click())
      layout.buttonTop = 700
      layout.buttonBottom = 730
      act(() => {
        page.querySelector('.scene-add-list ul')!.dispatchEvent(new Event('scroll'))
      })
      expect(menu(page).classList.contains('scene-add-up')).toBe(false)
      act(() => {
        document.dispatchEvent(new Event('scroll'))
      })
      expect(menu(page).classList.contains('scene-add-up')).toBe(true)
    })

    it('is placed again on a resize whose target is the window, as in a browser', () => {
      // A browser's Node.contains throws on anything that is not a Node; the window is not one.
      const contains = Node.prototype.contains
      Node.prototype.contains = function (this: Node, other: Node | null) {
        if (other !== null && !(other instanceof Node)) throw new TypeError('not of type Node')
        return contains.call(this, other)
      }
      try {
        const page = render(open)
        act(() => add(page).click())
        layout.window = 500
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 })
        act(() => {
          window.dispatchEvent(new Event('resize'))
        })
        expect(menu(page).classList.contains('scene-add-up')).toBe(true)
      } finally {
        Node.prototype.contains = contains
      }
    })
  })

  it('closes on Escape and returns to the button', () => {
    const page = render(open)
    act(() => add(page).click())
    act(() => {
      find(page).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(page.querySelector('.scene-add-list')).toBeNull()
    expect(document.activeElement).toBe(add(page))
  })

  it('reopens with an empty find box and every effect after a click outside closed it', () => {
    const page = render(open)
    act(() => add(page).click())
    type(find(page), 'purr')
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(page.querySelector('.scene-add-list')).toBeNull()
    act(() => add(page).click())
    expect(find(page).value).toBe('')
    expect(page.querySelectorAll('.scene-add-list li').length).toBe(4)
  })

  it('reopens with an empty find box after its button closed it', () => {
    const page = render(open)
    act(() => add(page).click())
    type(find(page), 'purr')
    act(() => add(page).click())
    expect(page.querySelector('.scene-add-list')).toBeNull()
    act(() => add(page).click())
    expect(find(page).value).toBe('')
    expect(page.querySelectorAll('.scene-add-list li').length).toBe(4)
  })
})

describe('leaving a scene with unsaved changes', () => {
  const dialog = () => document.querySelector('[role=alertdialog]')
  const ask = async (page: HTMLElement) => {
    type(musicLevel(page), '40')
    act(() => button(page, 'Refresh from the game').click())
    await flush()
  }

  it('asks before Refresh from the game, focus on Save, and Cancel goes back', async () => {
    const page = render(open)
    button(page, 'Refresh from the game').focus()
    await ask(page)
    expect(text(dialog()!.querySelector('h2'))).toBe('Save the changes to General store?')
    expect(text(dialog()!.querySelector('p'))).toBe("If you don't, they are lost.")
    expect([...dialog()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      "Don't save",
      'Cancel',
      'Save',
    ])
    expect(document.activeElement).toBe(dialog()!.querySelector('.btn-primary'))
    expect(asked.some((a) => a.method === 'POST')).toBe(false)
    act(() => {
      dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(button(page, 'Refresh from the game'))
    expect(status(page)).toBe('Unsaved changes')
  })

  it('refreshes after Don’t save, with the changes gone', async () => {
    const page = render(open)
    await ask(page)
    act(() => button(page, "Don't save").click())
    await flush()
    expect(asked).toContainEqual({ method: 'POST', path: '/api/parts/act1/refresh' })
    expect(status(page)).toBeUndefined()
  })

  it('saves first and then refreshes', async () => {
    const page = render(open)
    await ask(page)
    act(() => dialog()!.querySelector<HTMLButtonElement>('.btn-primary')!.click())
    await flush()
    expect(puts.length).toBe(1)
    expect(asked).toContainEqual({ method: 'POST', path: '/api/parts/act1/refresh' })
  })

  it('stays when the save is refused', async () => {
    saveAnswer = { status: 409, body: { ok: false, kind: 'failed', message: 'no' } }
    const page = render(open)
    await ask(page)
    act(() => dialog()!.querySelector<HTMLButtonElement>('.btn-primary')!.click())
    await flush()
    expect(asked.some((a) => a.method === 'POST')).toBe(false)
    expect(page.querySelector('[aria-label="Save failed"]')).not.toBeNull()
  })

  it('keeps the dialog’s Save dimmed, and the dialog open, while rows are red', async () => {
    const page = render(open)
    type(rows(page)[0]!.querySelector<HTMLInputElement>('.scene-num')!, '')
    act(() => button(page, 'Refresh from the game').click())
    await flush()
    const save = dialog()!.querySelector<HTMLButtonElement>('.btn-primary')!
    expect(save.getAttribute('aria-disabled')).toBe('true')
    act(() => save.click())
    await flush()
    expect(dialog()).not.toBeNull()
    expect(puts).toEqual([])
  })

  it('does not ask when nothing is unsaved', async () => {
    const page = render(open)
    act(() => button(page, 'Refresh from the game').click())
    await flush()
    expect(dialog()).toBeNull()
    expect(asked).toContainEqual({ method: 'POST', path: '/api/parts/act1/refresh' })
  })

  it.each([
    ['another scene', '#/scenes/parts/act1?scene=act1-forest'],
    ['another page', '#/music'],
  ])(
    'undoes a move to %s before the router follows it and asks; Don’t save goes on',
    async (_name, target) => {
      // The page's own router, as in the app (`routeHold.test.tsx` pins that it asks the page first).
      const Routed = () => {
        const route = useRoute()
        return route.view === 'scenes'
          ? createElement(ScenesView, { summary: summary(), route })
          : null
      }
      // A browser's history: the move is undone along it (`sceneDraft.test.tsx` pins Back too).
      const history = fakeHistory('#/scenes/parts/act1?scene=act1-store')
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, enabled: false } },
      })
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      cleanups.push(() => {
        act(() => root.unmount())
        history.restore()
      })
      act(() => root.render(createElement(QueryClientProvider, { client }, createElement(Routed))))
      type(musicLevel(container), '40')
      act(() => history.click(target))
      expect(dialog()).not.toBeNull()
      expect(text(container.querySelector('h1'))).toBe('General store')
      // The browser's moves along the history land a moment later.
      const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 5)))
      await settle()
      expect(window.location.hash).toBe('#/scenes/parts/act1?scene=act1-store')
      act(() => button(container, "Don't save").click())
      await settle()
      expect(window.location.hash).toBe(target)
      expect(history.hashes()).toEqual(['#/scenes/parts/act1?scene=act1-store', target])
      expect(text(container.querySelector('h1'))).not.toBe('General store')
    },
  )

  it('asks the browser before the tab is closed, only while there are unsaved changes', () => {
    const page = render(open)
    const close = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(close()).toBe(false)
    type(musicLevel(page), '40')
    expect(close()).toBe(true)
    act(() => button(page, 'Discard').click())
    expect(close()).toBe(false)
  })
})

describe('what the page started from', () => {
  /** A page that can be shown again with other data, as a refetch does. */

  it('sends the entry the draft began from, even if the project is read again meanwhile', async () => {
    const { page, show } = renderLive(open, summary())
    type(musicLevel(page), '40')
    // Another tab saved the scene, and this page's data was refetched.
    const changed = summary()
    changed.scenes!.acts[0]!.scenes[0]!.entry = { music: { track: null, level: 2 }, effects: [] }
    show(changed)
    act(() => button(page, 'Save').click())
    await flush()
    expect(puts[0]!.body.was?.music).toEqual({ track: 'act1-store', level: 1 })
  })

  it('does not say Saved again when a scene saved earlier is opened again', async () => {
    const { page, show } = renderLive(open, summary())
    type(musicLevel(page), '40')
    act(() => button(page, 'Save').click())
    await flush()
    expect(status(page)).toBe('Saved')
    show(summary(), { ...open, scene: 'act1-forest' })
    show(summary(), open)
    expect(status(page)).toBeUndefined()
  })
})

describe('playing a scene', () => {
  const bar = (page: HTMLElement) => page.querySelector<HTMLElement>('.scene-playbar')!
  const press = (page: HTMLElement, label: string) =>
    act(() => page.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click())
  const rowText = (page: HTMLElement, id: string, nth = 0) =>
    text(
      [...page.querySelectorAll('.scene-effects tbody tr')].filter((r) =>
        r.textContent!.includes(id),
      )[nth],
    )

  it('shows the play bar stopped: the clock, the first state on, triggers dimmed, no Now column', () => {
    const page = render(open)
    expect(text(bar(page))).toBe('0:00Stateplaincat-homeTriggersdoor-opens ⚡')
    expect(
      bar(page).querySelector('[aria-label="Start the scene"]')?.getAttribute('aria-disabled'),
    ).toBeNull()
    expect(bar(page).querySelector('.scene-seg .on')?.textContent).toBe('plain')
    expect(
      [...bar(page).querySelectorAll('.btn')].map((b) => b.getAttribute('aria-disabled')),
    ).toEqual(['true'])
    expect([...page.querySelectorAll('th')].map((th) => th.textContent)).not.toContain('Now')
  })

  it('keeps a blank Now cell on every effect row while stopped, whole in its title once playing (as-h01)', async () => {
    const page = render(open)
    const cells = () => [...page.querySelectorAll<HTMLElement>('.scene-effects td.scene-now')]
    const rows = page.querySelectorAll('.scene-effects tbody tr').length
    expect(cells().length).toBe(rows)
    expect(
      cells().every((c) => c.textContent === '' && c.classList.contains('scene-now-idle')),
    ).toBe(true)
    press(page, 'Start the scene')
    await flush()
    expect(cells().length).toBe(rows)
    expect(cells().some((c) => c.classList.contains('scene-now-idle'))).toBe(false)
    for (const c of cells()) expect(c.getAttribute('title') ?? '').toBe(c.textContent ?? '')
    expect(cells().some((c) => c.textContent!.includes('Next in'))).toBe(true)
    press(page, 'Stop the scene')
    await flush()
    expect(
      cells().every((c) => c.textContent === '' && c.classList.contains('scene-now-idle')),
    ).toBe(true)
  })

  it('leaves State out for a scene with no states, and says when there is nothing to play', () => {
    const page = render({ ...open, scene: 'act1-chapel' })
    expect(text(bar(page))).toBe('Nothing to play in this sceneTriggersbell-tolls ⚡')
    press(page, 'Start the scene')
    expect(bar(page).querySelector('[aria-label="Stop the scene"]')).toBeNull()
  })

  it('reserves no count slot in the play bar of a scene with nothing to play (as-0q9)', () => {
    const page = render({ ...open, scene: 'act1-chapel' })
    expect(bar(page).querySelector('.scene-bar-count')).toBeNull()
  })

  it('keeps Clear in the play bar when a scene is edited down to nothing with a solo set (as-0q9)', () => {
    const page = render(open)
    press(page, 'Solo the music')
    choose(menu(page, 'Music'), 'No music')
    while (rows(page).length > 0)
      act(() => rows(page)[0]!.querySelector<HTMLButtonElement>('[data-remove]')!.click())
    expect(text(bar(page))).toContain('Nothing to play in this scene')
    expect(text(bar(page).querySelector('.scene-bar-count'))).toContain('Solo: 1')
    act(() => button(bar(page), 'Clear').click())
    expect(bar(page).querySelector('.scene-bar-count')).toBeNull()
  })

  it('sets the state while stopped, without playing', () => {
    const page = render(open)
    act(() => button(bar(page), 'cat-home').click())
    expect(bar(page).querySelector('.scene-seg .on')?.textContent).toBe('cat-home')
    expect(page.querySelector('.scene-playbar [aria-label="Stop the scene"]')).toBeNull()
  })

  it('plays: Now column with the words of each row, state switching, then stops', async () => {
    const page = render(open)
    press(page, 'Start the scene')
    await flush()
    expect(bar(page).querySelector('[aria-label="Stop the scene"]')).not.toBeNull()
    expect([...page.querySelectorAll('th')].map((th) => th.textContent)[0]).toBe('Now')
    expect(text(page.querySelector('.scene-music-now'))).toBe('Playing')
    expect(rowText(page, 'shop-bell', 0)).toContain('In 2 s')
    expect(rowText(page, 'glass-clink')).toContain('Next in')
    expect(rowText(page, 'cat-purr')).toContain('Not in plain')
    expect(rowText(page, 'shop-bell', 1)).toContain('Waits for door-opens')
    expect(
      [...bar(page).querySelectorAll('.btn')].map((b) => b.getAttribute('aria-disabled')),
    ).toEqual([null])
    act(() => button(bar(page), 'cat-home').click())
    await flush()
    expect(rowText(page, 'cat-purr')).toContain('Playing')
    expect(page.querySelectorAll('.scene-sounding').length).toBe(1)
    press(page, 'Stop the scene')
    await flush()
    expect([...page.querySelectorAll('th')].map((th) => th.textContent)).not.toContain('Now')
  })

  it('mutes and solos for listening only, counts them and clears them', async () => {
    const page = render(open)
    press(page, 'Mute shop-bell')
    expect(text(bar(page))).toContain('Muted: 1')
    press(page, 'Solo glass-clink')
    expect(text(bar(page))).toContain('Solo: 1 · Muted: 1')
    expect(page.querySelector('[aria-label="Mute shop-bell"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(text(page.querySelector('.scene-status'))).toBeUndefined()
    press(page, 'Start the scene')
    await flush()
    expect(rowText(page, 'shop-bell', 0)).toContain('not soloed')
    expect(rowText(page, 'glass-clink')).not.toContain('not soloed')
    act(() => button(bar(page), 'Clear').click())
    expect(text(bar(page))).not.toContain('Muted')
    expect(button(bar(page), 'cat-home')).toBeDefined()
    press(page, 'Stop the scene')
    await flush()
  })

  it('keeps a blank count slot in the play bar, and focus on Start/Stop after Clear (as-lzp)', async () => {
    const page = render(open)
    const slot = () => bar(page).querySelector<HTMLElement>('.scene-bar-count')
    expect(slot()).not.toBeNull()
    expect(text(slot())).toBe('')
    expect(slot()?.querySelector('button')).toBeNull()
    press(page, 'Solo glass-clink')
    expect(text(slot())).toContain('Solo: 1')
    expect(slot()?.querySelector('button')?.textContent).toBe('Clear')
    press(page, 'Mute shop-bell')
    expect(text(slot())).toContain('Solo: 1 · Muted: 1')
    act(() => button(bar(page), 'Clear').click())
    expect(text(slot())).toBe('')
    press(page, 'Mute shop-bell')
    expect(text(slot())).toContain('Muted: 1')
    act(() => button(bar(page), 'Clear').click())
    expect(text(slot())).toBe('')
    expect(document.activeElement).toBe(bar(page).querySelector('[aria-label="Start the scene"]'))
  })

  it('says muted on a muted row that keeps its words', async () => {
    const page = render(open)
    press(page, 'Mute shop-bell')
    press(page, 'Start the scene')
    await flush()
    expect(rowText(page, 'shop-bell', 0)).toContain('In 2 s, muted')
    press(page, 'Stop the scene')
    await flush()
  })

  it('stops and clears Mute and Solo when another scene opens', async () => {
    const { page, show } = renderLive(open, summary())
    press(page, 'Mute shop-bell')
    press(page, 'Start the scene')
    await flush()
    show(summary(), { ...open, scene: 'act1-forest' })
    await flush()
    expect(page.querySelector('[aria-label="Stop the scene"]')).toBeNull()
    expect(text(bar(page))).not.toContain('Muted')
    show(summary(), open)
    await flush()
    expect(text(bar(page))).not.toContain('Muted')
  })

  it('plays a row once over the scene when ▶ is pressed while it plays, and the scene keeps going', async () => {
    const page = render(open)
    press(page, 'Start the scene')
    await flush()
    const before = loops.length
    press(page, 'Play shop-bell')
    await flush()
    expect(loops.length).toBe(before + 1)
    expect(page.querySelector('[aria-label="Stop the scene"]')).not.toBeNull()
    expect(page.querySelector('[aria-label="Stop shop-bell"]')).toBeNull()
    press(page, 'Stop the scene')
    await flush()
  })

  it('does not tint or animate a silent loop row, and says Silent', async () => {
    const purr = effects.rows.find((r) => r.id === 'cat-purr')!
    const was = purr.current
    purr.current = { kind: 'nothing' } as typeof purr.current
    try {
      const page = render(open)
      act(() => button(bar(page), 'cat-home').click())
      press(page, 'Start the scene')
      await flush()
      expect(rowText(page, 'cat-purr')).toContain('Silent')
      expect(page.querySelectorAll('.scene-sounding')).toHaveLength(0)
      expect(page.querySelectorAll('.scene-eq')).toHaveLength(0)
      press(page, 'Stop the scene')
      await flush()
    } finally {
      purr.current = was
    }
  })

  it('says Couldn’t load the clip in red by the music, and plays the rest', async () => {
    const real = globalThis.fetch
    globalThis.fetch = (async (path: string, init?: RequestInit) =>
      String(path).startsWith('/api/music/')
        ? new Response('no', { status: 404 })
        : real(path, init)) as typeof fetch
    try {
      const page = render(open)
      press(page, 'Start the scene')
      await flush()
      const word = page.querySelector('.scene-music-now')!
      expect(word.textContent).toBe("Couldn't load the clip")
      expect(word.classList.contains('scene-now-bad')).toBe(true)
      expect(rowText(page, 'glass-clink')).toContain('Next in')
      press(page, 'Stop the scene')
      await flush()
    } finally {
      globalThis.fetch = real
    }
  })

  it('says Not played by the music when the game no longer has its track', async () => {
    const shown = summary()
    const scene = shown.scenes!.acts[0]!.scenes[0]!
    scene.music = { ...scene.music, track: 'old-track', name: 'old-track', gone: true }
    const page = render(open, shown)
    press(page, 'Start the scene')
    await flush()
    expect(text(page.querySelector('.scene-music-now'))).toBe('Not played')
    press(page, 'Stop the scene')
    await flush()
  })
})

const measureOf = (over: Partial<SceneMeasure> = {}): SceneMeasure => ({
  measuredAt: new Date(2026, 10, 5, 14, 2).toISOString(),
  entry: null,
  clips: {},
  states: [
    { state: 'plain', lufs: -19.4 },
    { state: 'cat-home', lufs: -23.8 },
  ],
  without: [],
  error: null,
  ...over,
})
const target = { target: -20, tolerance: 2 }

describe('the Loudness panel', () => {
  /** The saved store scene as the page has it, so a measure of it is not "changed since measured". */
  const savedStore = () => {
    const scene = summary().scenes!.acts[0]!.scenes[0]!
    return measureOf({ entry: scene.entry, clips: scene.clips })
  }
  const panel = (page: HTMLElement) => page.querySelector('[aria-label="Loudness"]') as HTMLElement
  const loudness = (saved: SceneMeasure | null, draft: SceneMeasure | null = null) => ({
    'act1-store': { saved, draft },
  })

  it('sits above Music, with the target, and says it was never measured', () => {
    const page = render(open, summary('ok', true, { target }))
    const sections = [...page.querySelectorAll('section.scene-panel')].map((s) =>
      s.getAttribute('aria-label'),
    )
    expect(sections.slice(0, 2)).toEqual(['Loudness', 'Music'])
    expect(text(panel(page).querySelector('h2'))).toBe('Loudness target −20 LUFS ± 2 dB')
    expect(text(panel(page))).toContain('target −20 LUFS ± 2 dB')
    expect(panel(page).querySelector('table')).toBeNull()
    expect(text(panel(page))).toContain(
      'Not measured yet. Measure loudness measures every scene in Act I.',
    )
    expect(text(button(panel(page), 'Measure loudness'))).toBe('Measure loudness')
  })

  it('shows a row for each state with its figure and a chip against the target', () => {
    const page = render(open, summary('ok', true, { target, loudness: loudness(savedStore()) }))
    const rows = [...panel(page).querySelectorAll('tbody tr')].map((tr) => text(tr))
    expect(rows).toEqual(['plain−19.4 LUFSon target', 'cat-home−23.8 LUFS3.8 dB too quiet'])
    expect(text(panel(page).querySelector('.scene-loud-when'))).toBe('Measured today 14:02')
    expect([...panel(page).querySelectorAll('th')].map((th) => text(th))).toEqual([
      'State',
      'Loudness',
      '',
    ])
  })

  it('says "no target set", draws no chips and tells where to set one', () => {
    const page = render(open, summary('ok', true, { loudness: loudness(savedStore()) }))
    expect(text(panel(page).querySelector('h2 + .faint, .scene-loud-target'))).toBe('no target set')
    expect(panel(page).querySelectorAll('.chip').length).toBe(0)
    expect(text(panel(page).querySelector('.scene-loud-when'))).toBe(
      'Measured today 14:02 · Set a loudness target and tolerance in the project file to be told which scenes are off.',
    )
  })

  it('names a scene without states "The scene", and nothing playing without a chip', () => {
    const chapelMeasure = measureOf({
      states: [{ state: null, lufs: null }],
    })
    const page = render(
      { ...open, scene: 'act1-chapel' },
      summary('ok', true, {
        target,
        loudness: { 'act1-chapel': { saved: chapelMeasure, draft: null } },
      }),
    )
    const rows = [...panel(page).querySelectorAll('tbody tr')].map((tr) => text(tr))
    expect(rows).toEqual(['The scenenothing plays'])
  })

  it('words a loud state and names what was left out', () => {
    const page = render(
      open,
      summary('ok', true, {
        target,
        loudness: loudness({
          ...savedStore(),
          states: [
            { state: 'plain', lufs: -15.9 },
            { state: 'cat-home', lufs: -20 },
          ],
          without: ['glass-clink, which has no take chosen'],
        }),
      }),
    )
    expect(text(panel(page).querySelectorAll('tbody tr')[0])).toBe('plain−15.9 LUFS4.1 dB too loud')
    expect(text(panel(page).querySelector('.scene-loud-when'))).toBe(
      'Measured today 14:02 · without glass-clink, which has no take chosen',
    )
  })

  it('says a scene changed since it was measured, and keeps the figures', () => {
    const changed = { ...savedStore(), clips: { 'effect:shop-bell': 'take 9' } }
    const page = render(open, summary('ok', true, { target, loudness: loudness(changed) }))
    expect(text(panel(page).querySelector('h2'))).toContain('· changed since measured')
    expect(panel(page).querySelectorAll('tbody tr').length).toBe(2)
  })

  it('shows "couldn’t measure" and the reason in a red box when a scene could not be measured', () => {
    const failed = measureOf({
      error: 'ffmpeg fell over',
      states: [
        { state: 'plain', lufs: null },
        { state: 'cat-home', lufs: null },
      ],
    })
    const page = render(open, summary('ok', true, { target, loudness: loudness(failed) }))
    const cells = [...panel(page).querySelectorAll('tbody td.scene-loud-bad')].map((td) => text(td))
    expect(cells).toEqual(['couldn’t measure', 'couldn’t measure'])
    expect(text(panel(page).querySelector('.scene-problem'))).toBe(
      'Couldn’t measure General store: ffmpeg fell over. The other scenes were measured.',
    )
  })

  it('presses Measure loudness for the whole act, sending the scene as it is on the page', async () => {
    const page = render(open, summary('ok', true, { target }))
    await act(async () => button(panel(page), 'Measure loudness').click())
    expect(measures.map((m) => m.path)).toEqual(['/api/scene-loudness/act1'])
    expect(measures[0]!.body.open).toBeUndefined()
  })

  it('sends the unsaved scene, and shows it with a word until Save; Discard puts the saved figures back', async () => {
    const draftMeasure = measureOf({
      states: [
        { state: 'plain', lufs: -18 },
        { state: 'cat-home', lufs: -18 },
      ],
    })
    const page = render(
      open,
      summary('ok', true, { target, loudness: loudness(savedStore(), draftMeasure) }),
    )
    // Change the scene on the page (the music's level).
    const slider = page.querySelector('input[type="range"]') as HTMLInputElement
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(slider, '50')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => button(panel(page), 'Measure loudness').click())
    expect(measures[0]!.body.open?.scene).toBe('act1-store')
    expect(measures[0]!.body.open?.entry.music?.level).toBe(0.5)
    // The kept draft is of another version of the scene: the saved figures show.
    expect(text(panel(page).querySelectorAll('tbody tr')[0])).toBe('plain−19.4 LUFSon target')
  })

  it('shows the draft measure when the page still has what it was measured from', async () => {
    const store = summary().scenes!.acts[0]!.scenes[0]!
    const entry = { ...store.entry!, music: { track: 'act1-store', level: 0.5 } }
    const draftMeasure = measureOf({
      entry,
      states: [
        { state: 'plain', lufs: -18 },
        { state: 'cat-home', lufs: -18 },
      ],
    })
    const page = render(
      open,
      summary('ok', true, { target, loudness: loudness(savedStore(), draftMeasure) }),
    )
    const slider = page.querySelector('input[type="range"]') as HTMLInputElement
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(slider, '50')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(text(panel(page).querySelector('h2'))).toContain('· with your unsaved changes')
    expect(text(panel(page).querySelectorAll('tbody tr')[0])).toBe('plain−18.0 LUFSon target')
    await act(async () => button(page, 'Discard').click())
    expect(text(panel(page).querySelector('h2'))).not.toContain('unsaved')
    expect(text(panel(page).querySelectorAll('tbody tr')[0])).toBe('plain−19.4 LUFSon target')
  })

  it('shows how far a measure of the act has got, with the button off and the figures kept', () => {
    const page = render(open, summary('ok', true, { target, loudness: loudness(savedStore()) }), {
      act1: { done: 1, total: 5 },
    })
    const measuring = button(panel(page), 'Measuring 2 of 5…')
    expect(measuring.getAttribute('aria-disabled')).toBe('true')
    expect(panel(page).querySelectorAll('tbody tr').length).toBe(2)
    expect(text(panel(page).querySelector('.scene-loud-when'))).toBe(
      'Measured today 14:02 · being measured again',
    )
  })

  it('says why a measure was refused', async () => {
    measureAnswer = { status: 409, body: { ok: false, message: 'the kept file cannot be read' } }
    const page = render(open, summary('ok', true, { target }))
    await act(async () => button(panel(page), 'Measure loudness').click())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(text(panel(page).querySelector('.scene-problem'))).toBe('the kept file cannot be read')
  })

  it('keeps showing a measure made with unsaved changes after one more edit, saying it changed', async () => {
    const draftMeasure = measureOf({ entry: { effects: [] } })
    const page = render(
      open,
      summary('ok', true, { target, loudness: loudness(null, draftMeasure) }),
    )
    const slider = page.querySelector('input[type="range"]') as HTMLInputElement
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(slider, '50')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(panel(page).querySelectorAll('tbody tr').length).toBe(2)
    expect(text(panel(page).querySelector('h2'))).toContain('· changed since measured')
  })

  it('does not start a second measure while one runs', async () => {
    const page = render(open, summary('ok', true, { target }), { act1: { done: 0, total: 3 } })
    await act(async () => button(panel(page), 'Measuring 1 of 3…').click())
    expect(measures).toEqual([])
  })

  it('has no panel for a scene whose entry cannot be read', () => {
    const shown = summary('ok', true, { target })
    shown.scenes!.acts[0]!.scenes[0]!.unreadable = true
    expect(panel(render(open, shown))).toBeNull()
  })

  it('marks scenes off the target in the list, amber, from the last measure', () => {
    const shown = summary('ok', true, {
      target,
      loudness: {
        'act1-store': { saved: savedStore(), draft: null },
        'act1-chapel': {
          saved: measureOf({ states: [{ state: null, lufs: -12 }] }),
          draft: null,
        },
      },
    })
    const page = render(open, shown)
    const counts = [...page.querySelectorAll('.scene-list li')].map((li) =>
      text(li.querySelector('.scene-count')),
    )
    expect(counts).toEqual(['too quiet', '1 gone', 'too loud'])
    expect(page.querySelectorAll('.scene-count-warn').length).toBe(2)
    const none = render(
      open,
      summary('ok', true, {
        loudness: shown.scenes!.acts[0]!.scenes.reduce(
          (m, s) => ({ ...m, [s.id]: s.loudness }),
          {},
        ),
      }),
    )
    expect(
      [...none.querySelectorAll('.scene-list li')].map((li) =>
        text(li.querySelector('.scene-count')),
      ),
    ).toEqual(['4 effects', '1 gone', 'none'])
  })

  it('announces the end of a measure as a status', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, enabled: false } },
    })
    client.setQueryData(['scene-loudness'], { act1: { done: 2, total: 3 } })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    cleanups.push(() => act(() => root.unmount()))
    const show = () =>
      act(() =>
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            createElement(ScenesView, { summary: summary('ok', true, { target }), route: open }),
          ),
        ),
      )
    show()
    expect(text(container.querySelector('[role="status"].sr-only'))).toBe('')
    await act(async () => {
      client.setQueryData(['scene-loudness'], {})
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(text(container.querySelector('[role="status"].sr-only'))).toBe(
      'Measured 3 scenes in Act I.',
    )
  })
})

describe('the loudness suggestion', () => {
  const saved = (triggerLevel = 1) => {
    const scene = summary('ok', true, { triggerLevel }).scenes!.acts[0]!.scenes[0]!
    return measureOf({
      entry: scene.entry,
      clips: scene.clips,
      states: [
        { state: 'plain', lufs: -23.4 },
        { state: 'cat-home', lufs: -24.6 },
      ],
    })
  }
  const panel = (page: HTMLElement) => page.querySelector('[aria-label="Loudness"]') as HTMLElement
  const line = (page: HTMLElement) => text(panel(page).querySelector('.scene-suggest'))
  const withMeasure = (m: SceneMeasure, triggerLevel = 1) =>
    summary('ok', true, {
      target,
      triggerLevel,
      loudness: { 'act1-store': { saved: m, draft: null } },
    })
  const press = async (page: HTMLElement, label: string) =>
    act(async () => button(panel(page), label).click())

  it('offers one change for the whole scene, under the table', () => {
    const page = render(open, withMeasure(saved()))
    expect(line(page)).toBe(
      'Make the whole scene 4.0 dB louder — music and every effect by the same amount — to bring both states within the target.Make 4.0 dB louder',
    )
    const order = [...panel(page).children].map((c) => c.className || c.tagName)
    expect(order.indexOf('scene-suggest')).toBeGreaterThan(order.indexOf('scene-loud-table'))
    expect(order.indexOf('scene-suggest')).toBeLessThan(order.indexOf('faint scene-loud-when'))
  })

  it('says quieter for a scene that is too loud', () => {
    const page = render(
      open,
      withMeasure({
        ...saved(),
        states: [
          { state: 'plain', lufs: -16.2 },
          { state: 'cat-home', lufs: -17 },
        ],
      }),
    )
    expect(line(page)).toContain('3.4 dB quieter')
    expect(button(panel(page), 'Make 3.4 dB quieter')).toBeTruthy()
  })

  it('offers nothing when on target, without a target, or when nothing plays', () => {
    const on = { ...saved(), states: [{ state: 'plain', lufs: -20 }] }
    expect(panel(render(open, withMeasure(on))).querySelector('.scene-suggest')).toBeNull()
    const none = { ...saved(), states: [{ state: 'plain', lufs: null }] }
    expect(panel(render(open, withMeasure(none))).querySelector('.scene-suggest')).toBeNull()
    const noTarget = summary('ok', true, {
      loudness: { 'act1-store': { saved: saved(), draft: null } },
    })
    expect(panel(render(open, noTarget)).querySelector('.scene-suggest')).toBeNull()
  })

  it('says why no louder change exists when a sound is at 300%, with no button', () => {
    const page = render(open, withMeasure(saved(3), 3))
    const p = panel(page)
    expect(line(page)).toContain('No change can make the whole scene louder:')
    expect(line(page)).toContain('is at 300%, as loud as it goes.')
    expect(text(panel(page).querySelector('.scene-suggest strong'))).not.toBe('')
    expect(p.querySelector('.scene-suggest-muted')).not.toBeNull()
    expect(p.querySelector('.scene-suggest strong')).not.toBeNull()
    expect(p.querySelector('.scene-suggest button')).toBeNull()
    const order = [...p.children].map((c) => c.className)
    expect(order.indexOf('scene-suggest scene-suggest-muted')).toBeLessThan(
      order.indexOf('faint scene-loud-when'),
    )
  })

  it('moves the music and every effect on the page only, and shows the expected figures', async () => {
    const page = render(open, withMeasure(saved()))
    await press(page, 'Make 4.0 dB louder')
    expect(puts).toEqual([])
    const levels = [...page.querySelectorAll('.scene-level')].map((n) => text(n))
    expect(levels.slice(0, 4)).toEqual(['158%', '95%', '79%', '158%'])
    const h2 = text(panel(page).querySelector('h2'))
    expect(h2).toContain('· expected after your change')
    const rows = [...panel(page).querySelectorAll('tbody tr')].map((tr) => text(tr))
    expect(rows).toEqual(['plain−19.4 LUFSon target', 'cat-home−20.6 LUFSon target'])
    expect(panel(page).querySelector('.scene-suggest')).toBeNull()
    expect(text(panel(page))).toContain('Made 4.0 dB louder. Save to keep it, Discard to undo.')
    expect(text(panel(page).querySelector('.scene-loud-when'))).toBe(
      'Measured today 14:02, then made 4.0 dB louder',
    )
    expect(text(page.querySelector('.scene-list a[aria-current]'))).toContain('●')
    expect(text(page.querySelector('.scene-list a[aria-current]'))).toContain('4 effects')
    expect(document.activeElement).toBe(button(page, 'Save'))
  })

  it('puts the measured figures and the suggestion back on Discard', async () => {
    const page = render(open, withMeasure(saved()))
    await press(page, 'Make 4.0 dB louder')
    await act(async () => button(page, 'Discard').click())
    expect(text(panel(page).querySelectorAll('tbody tr')[0])).toBe(
      'plain−23.4 LUFS3.4 dB too quiet',
    )
    expect(line(page)).toContain('Make 4.0 dB louder')
    expect(text(page.querySelector('.scene-list a[aria-current]'))).toContain('too quiet')
  })

  it('sends the move with Save', async () => {
    const m = saved()
    const page = render(open, withMeasure(m))
    await press(page, 'Make 4.0 dB louder')
    await act(async () => button(page, 'Save').click())
    expect(puts[0]!.body.moved).toEqual({ db: 4, measuredAt: m.measuredAt })
    expect(puts[0]!.body.scene.music?.level).toBe(1.58)
  })

  it('keeps the expected figures once saved, with no muted line, until measured again', () => {
    const m = saved()
    // The project as read after the save: the saved scene is the measured one, moved.
    const after = summary('ok', true, {
      target,
      storeMix: scaleMix(m.entry!, 4),
      loudness: { 'act1-store': { saved: { ...m, moved: { db: 4 } }, draft: null } },
    })
    const page = render(open, after)
    expect(text(panel(page).querySelector('h2'))).toContain('· expected after your change')
    expect(panel(page).querySelectorAll('.chip-ok').length).toBe(2)
    expect(panel(page).querySelector('.scene-suggest')).toBeNull()
    expect(text(panel(page))).not.toContain('Save to keep it')
    expect(text(panel(page).querySelector('.faint.scene-loud-when'))).toBe(
      'Measured today 14:02, then made 4.0 dB louder',
    )
    expect(text(page.querySelector('.scene-list a[aria-current]'))).toContain('4 effects')
  })

  it('says the scene changed instead of offering a change after a level is moved by hand', async () => {
    const page = render(open, withMeasure(saved()))
    await press(page, 'Make 4.0 dB louder')
    const slider = page.querySelector('input[type="range"]') as HTMLInputElement
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(slider, '50')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(text(panel(page).querySelector('h2'))).toContain('· changed since measured')
    expect(panel(page).querySelector('.scene-suggest')).toBeNull()
    expect(text(panel(page))).toContain(
      'The scene changed since it was measured. Measure loudness again for a suggestion.',
    )
  })

  const drag = async (page: HTMLElement, value: string) => {
    const slider = page.querySelector('input[type="range"]') as HTMLInputElement
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(slider, value)
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  it('does not trust the kept figures once a level is moved by hand after a saved press', async () => {
    const m = saved()
    const after = summary('ok', true, {
      target,
      storeMix: scaleMix(m.entry!, 4),
      loudness: { 'act1-store': { saved: { ...m, moved: { db: 4 } }, draft: null } },
    })
    const page = render(open, after)
    await drag(page, '50')
    expect(text(panel(page).querySelector('h2'))).toContain('· changed since measured')
    expect(text(panel(page).querySelector('h2'))).not.toContain('expected')
    expect(text(panel(page))).not.toContain('Save to keep it')
    expect(text(panel(page))).toContain('The scene changed since it was measured.')
  })

  it('leaves the header alone for a hand edit on a measure nothing was pressed on', async () => {
    const page = render(open, withMeasure(saved()))
    await drag(page, '50')
    expect(text(panel(page).querySelector('h2'))).not.toContain('changed since measured')
  })

  it('drops the amber marks once an effect is removed after a press', async () => {
    const page = render(open, withMeasure(saved()))
    await press(page, 'Make 4.0 dB louder')
    const remove = page.querySelector('button[aria-label^="Remove"]') as HTMLButtonElement
    await act(async () => remove.click())
    expect(page.querySelectorAll('.scene-level-moved').length).toBe(0)
  })

  it('tells a screen reader what a moved level was', async () => {
    const page = render(open, withMeasure(saved()))
    await press(page, 'Make 4.0 dB louder')
    const slider = page.querySelector('input[type="range"]') as HTMLInputElement
    expect(slider.getAttribute('aria-valuetext')).toBe('158% (was 100%)')
  })

  it('shows the levels the press moved as changed, and not once discarded', async () => {
    const page = render(open, withMeasure(saved()))
    await press(page, 'Make 4.0 dB louder')
    expect(page.querySelectorAll('.scene-level-moved').length).toBe(5)
    await act(async () => button(page, 'Discard').click())
    expect(page.querySelectorAll('.scene-level-moved').length).toBe(0)
  })

  it('shows the expected figures after the press on a scene with no music', async () => {
    const m = saved()
    const entry = { music: { track: null, level: 1 }, effects: m.entry!.effects }
    const page = render(
      open,
      summary('ok', true, {
        target,
        storeMix: entry,
        loudness: {
          'act1-store': {
            saved: {
              ...m,
              entry,
              clips: Object.fromEntries(
                Object.entries(m.clips).filter(([k]) => !k.startsWith('music:')),
              ),
            },
            draft: null,
          },
        },
      }),
    )
    await press(page, 'Make 4.0 dB louder')
    expect(text(panel(page).querySelector('h2'))).toContain('· expected after your change')
    expect(text(panel(page))).toContain('Made 4.0 dB louder. Save to keep it, Discard to undo.')
=======
  it('says the scene changed, not why nothing can go louder, after a level is moved by hand', async () => {
    const page = render(open, withMeasure(saved(3), 3))
    const slider = page.querySelector('input[type="range"]') as HTMLInputElement
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(slider, '50')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(panel(page).querySelector('.scene-suggest-muted')).toBeNull()
    expect(text(panel(page))).toContain('The scene changed since it was measured.')
  })

  it('still offers the ordinary change to a too loud scene with a sound at 300%', () => {
    const page = render(
      open,
      withMeasure({ ...saved(3), states: [{ state: 'plain', lufs: -16.2 }] }, 3),
    )
    expect(button(panel(page), 'Make 3.8 dB quieter')).toBeTruthy()
    expect(panel(page).querySelector('.scene-suggest-muted')).toBeNull()
>>>>>>> fa28d6c (test(as-w5p): pin states 7, 8 and 10 of the limit line; simplify limitLine)
  })

  it('says it too when the scene was changed and saved since it was measured', () => {
    const page = render(open, withMeasure({ ...saved(), clips: { 'effect:shop-bell': 'take 9' } }))
    expect(panel(page).querySelector('.scene-suggest')).toBeNull()
    expect(text(panel(page))).toContain('The scene changed since it was measured.')
  })

  it('keeps the line but disables its button while measuring', async () => {
    const page = render(open, withMeasure(saved()), { act1: { done: 0, total: 3 } })
    const b = button(panel(page), 'Make 4.0 dB louder')
    expect(b.getAttribute('aria-disabled')).toBe('true')
    await act(async () => b.click())
    expect(text(panel(page).querySelector('h2'))).not.toContain('expected')
  })

  it('words a scene with no states: one row "The scene", and "it"', () => {
    const m = { ...saved(), states: [{ state: null, lufs: -24.1 }] }
    const page = render(open, withMeasure(m))
    expect(text(panel(page).querySelector('tbody tr'))).toBe('The scene−24.1 LUFS4.1 dB too quiet')
    expect(line(page)).toContain('to bring it within the target.Make 4.1 dB louder')
  })

  it('announces the press as a status, and does not say it changed when put back by hand', async () => {
    const page = render(open, withMeasure(saved()))
    await press(page, 'Make 4.0 dB louder')
    expect(text(panel(page).querySelector('[role="status"]'))).toBe(
      'Made 4.0 dB louder. Save to keep it, Discard to undo.',
    )
  })

  it('offers the closest change, the ceiling and nothing, in the words agreed', () => {
    const apart = render(
      open,
      withMeasure({
        ...saved(),
        states: [
          { state: 'plain', lufs: -19.4 },
          { state: 'cat-home', lufs: -23.8 },
        ],
      }),
    )
    expect(line(apart)).toBe(
      'No single change brings both states within ± 2 dB: they are 4.4 dB apart. 1.6 dB louder comes closest, leaving each 0.2 dB off.Make 1.6 dB louder',
    )
    const capped = render(open, withMeasure(saved(2.5), 2.5))
    expect(line(capped)).toBe(
      'Make the whole scene 1.5 dB louder — as far as it goes before shop-bell passes 300%. That state would still be 3.1 dB too quiet; turn shop-bell down or the others up by hand to go further.Make 1.5 dB louder',
    )
    const nothing = render(
      open,
      withMeasure({
        ...saved(),
        states: [
          { state: 'plain', lufs: -16.9 },
          { state: 'cat-home', lufs: -22.8 },
        ],
      }),
    )
    expect(text(panel(nothing).querySelector('.scene-suggest'))).toBe(
      'No single change helps: plain is too loud and cat-home too quiet. Bring them closer in the scene’s levels.',
    )
  })
})
