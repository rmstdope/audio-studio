import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { EffectsSummary } from '../../../core/effects'
import type { MusicListSummary, TrackRow } from '../../../core/music'
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
const puts: { path: string; body: { scene: SceneMix; was: SceneMix | null } }[] = []
let saveAnswer: { status: number; body: unknown } = { status: 200, body: { ok: true } }
let saveGate: Promise<void> | null = null
const gains: number[] = []
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
  saveAnswer = { status: 200, body: { ok: true } }
  saveGate = null
  globalThis.fetch = (async (path: string, init?: RequestInit) => {
    asked.push({ method: init?.method ?? 'GET', path })
    if (init?.method === 'PUT') {
      puts.push({ path, body: JSON.parse(init.body as string) })
      await saveGate
      return Response.json(saveAnswer.body, { status: saveAnswer.status })
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
      [...tr.querySelectorAll('td')].slice(1, 5).map((td) => text(td)),
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
      })
    }
    const page = render(open, shown)
    act(() => add(page).click())
    expect(page.querySelectorAll('.scene-add-list li').length).toBe(13)
    expect(page.querySelector('.scene-add-list .muted')).toBeNull()
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

  it('leaves State out for a scene with no states, and says when there is nothing to play', () => {
    const page = render({ ...open, scene: 'act1-chapel' })
    expect(text(bar(page))).toBe('Nothing to play in this sceneTriggersbell-tolls ⚡')
    press(page, 'Start the scene')
    expect(bar(page).querySelector('[aria-label="Stop the scene"]')).toBeNull()
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
