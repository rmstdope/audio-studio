import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { MusicListSummary, TrackRow } from '../../../core/music'
import type { MusicTakesView, TakeView } from '../../../core/musicTake'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { TakesPanel } = await import('./TakesPanel')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((c) => c())
})
afterAll(() => GlobalRegistrator.unregister())

const row = (id: string, title: string, over: Partial<TrackRow> = {}): TrackRow => ({
  id,
  title,
  plays: null,
  brief: 'b',
  seconds: 60,
  bpm: null,
  key: null,
  game: { brief: 'b', seconds: 60, bpm: null, key: null },
  status: 'not-chosen',
  changed: [],
  chosenAt: null,
  current: { kind: 'none' },
  gameFile: null,
  ...over,
})
const list = (
  id: string,
  kind: 'act' | 'stingers',
  title: string,
  tracks: TrackRow[],
  state: MusicListSummary['state'] = 'ok',
): MusicListSummary => ({
  id,
  kind,
  title,
  state,
  tracks,
  orphans: [],
  dropped: 0,
  canRefresh: false,
})

const village = row('village', 'Willowbrook village')
const lists = [
  list('act1', 'act', 'Act 1: The Call', [village, row('inn', 'The inn', { status: 'chosen' })]),
  list('act2', 'act', 'Act 2: The Wood', [row('hut', "Witch's hut")]),
  list('act3', 'act', 'Act 3: The End', [], 'missing'),
  list('stingers', 'stingers', 'Stingers', [row('win', 'Victory'), row('lose', 'Game over')]),
]

const take = (n: number, over: Partial<TakeView> = {}): TakeView => ({
  n,
  file: `aaaaaaaaaaaaaaaa.${n}.wav`,
  seconds: 30,
  seed: n,
  peaks: [0.5],
  earlier: false,
  chosen: false,
  model: 'Balanced · XL turbo · 4B',
  ...over,
})
const view = (takes: TakeView[], over: Partial<MusicTakesView> = {}): MusicTakesView => ({
  ok: true,
  kind: 'loop',
  generator: { ok: true },
  defaultModel: 'balanced',
  models: [{ id: 'balanced', installed: true }],
  takes,
  making: [],
  failed: [],
  lockUnread: false,
  ...over,
})

let answer: unknown
const requests: { url: string; method: string; body: unknown }[] = []
beforeEach(() => {
  answer = { ok: true, n: 5 }
  requests.length = 0
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    requests.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    return new Response(JSON.stringify(answer))
  }) as typeof fetch
})

function render(
  trackRow: TrackRow,
  v: MusicTakesView,
  all: MusicListSummary[] = lists,
  trackId = trackRow.id,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(['music-takes', trackId], v)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  const show = (shown: MusicListSummary[]) =>
    act(() =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(TakesPanel, { track: trackRow, lists: shown }),
        ),
      ),
    )
  show(all)
  const buttons = (name: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => b.textContent === name,
    )
  const key = (target: Element, name: string, shiftKey = false) =>
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true }),
      )
    })
  return { client, buttons, key, rerender: show }
}

async function click(button: HTMLElement | undefined) {
  await act(async () => {
    button!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const dialog = () => document.querySelector('[role="dialog"]')
const option = (title: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((o) =>
    o.textContent!.startsWith(title),
  )!

describe('Move… on a take card', () => {
  it('is on a made take that is not chosen, and not on the chosen take or a take being made', () => {
    const page = render(
      village,
      view([take(1), take(2, { chosen: true })], {
        making: [{ n: 3, state: 'making', elapsed: 1, model: 'm', expected: 100 }],
      }),
    )
    expect(page.buttons('Move…')).toHaveLength(1)
  })

  it('waits with Choose and Drop while the music lock cannot be read', () => {
    const page = render(village, view([take(1)], { lockUnread: true }))
    expect(page.buttons('Move…')[0]!.disabled).toBe(true)
    expect(document.body.textContent).toContain(
      'Choosing, dropping and moving wait until the music lock can be read. You can still listen and make more takes.',
    )
  })

  it('is greyed and says why when the game has no other loop', () => {
    const only = [list('act1', 'act', 'Act 1', [village])]
    const page = render(village, view([take(1)]), only)
    const button = page.buttons('Move…')[0]!
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(document.body.textContent).toContain('There is no other loop to move it to.')
    return click(button).then(() => expect(dialog()).toBeNull())
  })

  it('says there is no other stinger for a stinger alone', () => {
    const only = [list('stingers', 'stingers', 'Stingers', [row('win', 'Victory')])]
    render(row('win', 'Victory'), view([take(1)], { kind: 'stinger' }), only)
    expect(document.body.textContent).toContain('There is no other stinger to move it to.')
  })
})

describe('the Move dialog', () => {
  it('lists every other loop by act, the track it is on greyed, and moves nothing until one is picked', async () => {
    const page = render(village, view([take(3)]))
    await click(page.buttons('Move…')[0])
    const text = dialog()!.textContent!
    expect(text).toContain('Move take 3 to another loop')
    expect(text).toContain(
      'It leaves Willowbrook village and joins the takes of the loop you pick.',
    )
    expect(text).toContain('Act 1')
    expect(text).toContain('The game has not listed the loops for Act 3 yet.')
    expect(text).toContain('chosen · 1:00')
    expect(option('Willowbrook village').disabled).toBe(true)
    expect(option('Willowbrook village').textContent).toContain('this track')
    expect(page.buttons('Move take 3')[0]!.disabled).toBe(true)
    expect(document.activeElement?.getAttribute('placeholder')).toBe('Find a loop')
  })

  it('filters by name and says when no loop matches', async () => {
    const page = render(village, view([take(3)]))
    await click(page.buttons('Move…')[0])
    const input = document.querySelector<HTMLInputElement>('input.filter')!
    const type = (value: string) =>
      act(() => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        set.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    type('witch')
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1)
    type('zzz')
    expect(dialog()!.textContent).toContain('No loop is called that.')
  })

  it('moves the take to the picked loop, shows where it went, and stays on the track', async () => {
    const page = render(village, view([take(3)]))
    await click(page.buttons('Move…')[0])
    await click(option("Witch's hut"))
    await click(page.buttons('Move take 3')[0])
    expect(requests.find((r) => r.method === 'POST')).toMatchObject({
      url: '/api/music/tracks/village/move',
      body: { file: 'aaaaaaaaaaaaaaaa.3.wav', to: 'hut' },
    })
    expect(dialog()).toBeNull()
    const line = document.querySelector('.moved')!
    expect(line.textContent).toContain("Take 3 moved to Witch's hut (Act 2), where it is take 5.")
    expect(line.querySelector('b')!.textContent).toBe("Witch's hut")
    expect(line.querySelector('a')!.getAttribute('href')).toBe('#/music/tracks/hut')
    expect(line.querySelector('a')!.textContent).toBe("Open Witch's hut")
    expect(document.activeElement).toBe(line)
    await click(line.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!)
    expect(document.querySelector('.moved')).toBeNull()
  })

  it('names no act for a stinger, and focuses the first row', async () => {
    answer = { ok: true, n: 2 }
    const page = render(row('win', 'Victory'), view([take(1)], { kind: 'stinger' }))
    await click(page.buttons('Move…')[0])
    expect(dialog()!.textContent).toContain('Move take 1 to another stinger')
    expect(document.querySelector('input.filter')).toBeNull()
    expect(document.activeElement).toBe(option('Game over'))
    await click(option('Game over'))
    await click(page.buttons('Move take 1')[0])
    expect(document.querySelector('.moved')!.textContent).toContain(
      'Take 1 moved to Game over, where it is take 2.',
    )
  })

  it('stays open with the reason when the move is refused, and keeps the pick', async () => {
    answer = { ok: false, message: "Witch's hut is being refreshed from the game." }
    const page = render(village, view([take(3)]))
    await click(page.buttons('Move…')[0])
    await click(option("Witch's hut"))
    await click(page.buttons('Move take 3')[0])
    expect(dialog()!.textContent).toContain(
      "Take 3 could not be moved: Witch's hut is being refreshed from the game. Nothing was changed.",
    )
    expect(option("Witch's hut").getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector('.moved')).toBeNull()
  })

  it('selects nothing and greys the button when the picked track leaves the game’s list', async () => {
    const page = render(village, view([take(3)]))
    await click(page.buttons('Move…')[0])
    await click(option("Witch's hut"))
    expect(page.buttons('Move take 3')[0]!.disabled).toBe(false)
    page.rerender([lists[0]!, list('act2', 'act', 'Act 2: The Wood', []), lists[2]!, lists[3]!])
    expect(page.buttons('Move take 3')[0]!.disabled).toBe(true)
    // It does not come back selected when the track returns.
    page.rerender(lists)
    expect(option("Witch's hut").getAttribute('aria-selected')).toBe('false')
    expect(page.buttons('Move take 3')[0]!.disabled).toBe(true)
  })

  it('keeps the keyboard in the dialog when the pick is dropped, so Esc still closes it', async () => {
    const page = render(village, view([take(3)]))
    await click(page.buttons('Move…')[0])
    await click(option("Witch's hut"))
    ;(page.buttons('Move take 3')[0] as HTMLButtonElement).focus()
    page.rerender([lists[0]!, list('act2', 'act', 'Act 2: The Wood', []), lists[2]!, lists[3]!])
    expect(document.activeElement).toBe(document.querySelector('input.filter'))
    page.key(document.activeElement!, 'Escape')
    await act(async () => {})
    expect(dialog()).toBeNull()
  })

  it('puts the focus on the first row left in a stinger dialog when the pick is dropped', async () => {
    const three = (rows: TrackRow[]) => [
      lists[0]!,
      lists[1]!,
      lists[2]!,
      list('stingers', 'stingers', 'Stingers', rows),
    ]
    const page = render(
      row('win', 'Victory'),
      view([take(1)], { kind: 'stinger' }),
      three([row('win', 'Victory'), row('lose', 'Game over'), row('lvl', 'Level up')]),
    )
    await click(page.buttons('Move…')[0])
    await click(option('Game over'))
    ;(page.buttons('Move take 1')[0] as HTMLButtonElement).focus()
    page.rerender(three([row('win', 'Victory'), row('lvl', 'Level up')]))
    expect(document.activeElement).toBe(option('Level up'))
  })

  it('puts the focus on Cancel when no row is left to pick', async () => {
    const page = render(row('win', 'Victory'), view([take(1)], { kind: 'stinger' }))
    await click(page.buttons('Move…')[0])
    await click(option('Game over'))
    ;(page.buttons('Move take 1')[0] as HTMLButtonElement).focus()
    page.rerender([
      lists[0]!,
      lists[1]!,
      lists[2]!,
      list('stingers', 'stingers', 'Stingers', [row('win', 'Victory')]),
    ])
    expect(document.activeElement).toBe(page.buttons('Cancel')[0]!)
    page.key(document.activeElement!, 'Escape')
    await act(async () => {})
    expect(dialog()).toBeNull()
  })

  it('keeps Tab and Shift+Tab inside the dialog while Move is greyed, and Esc still closes it', async () => {
    const page = render(village, view([take(3)]))
    await click(page.buttons('Move…')[0])
    const input = document.querySelector('input.filter')!
    const cancel = page.buttons('Cancel')[0]!
    expect(page.buttons('Move take 3')[0]!.disabled).toBe(true)
    cancel.focus()
    page.key(cancel, 'Tab')
    expect(document.activeElement).toBe(input)
    page.key(input, 'Tab', true)
    expect(document.activeElement).toBe(cancel)
    page.key(document.activeElement!, 'Escape')
    await act(async () => {})
    expect(dialog()).toBeNull()
  })

  it('wraps Tab from Move to the first control and Shift+Tab back, in a stinger dialog too', async () => {
    const page = render(row('win', 'Victory'), view([take(1)], { kind: 'stinger' }))
    await click(page.buttons('Move…')[0])
    await click(option('Game over'))
    const moveButton = page.buttons('Move take 1')[0]!
    expect(moveButton.disabled).toBe(false)
    moveButton.focus()
    page.key(moveButton, 'Tab')
    expect(document.activeElement).toBe(option('Game over'))
    page.key(option('Game over'), 'Tab', true)
    expect(document.activeElement).toBe(moveButton)
  })

  it('moves with Up, Down and Enter, and closes with Esc, focus back on Move…', async () => {
    const page = render(village, view([take(3)]))
    const opener = page.buttons('Move…')[0]!
    await click(opener)
    const input = document.querySelector('input.filter')!
    page.key(input, 'ArrowDown')
    expect(option('The inn').getAttribute('aria-selected')).toBe('true')
    page.key(document.activeElement!, 'ArrowDown')
    expect(option("Witch's hut").getAttribute('aria-selected')).toBe('true')
    page.key(document.activeElement!, 'Escape')
    await act(async () => {})
    expect(dialog()).toBeNull()
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0)
    expect(document.activeElement).toBe(opener)
    await click(opener)
    page.key(document.querySelector('input.filter')!, 'ArrowDown')
    await act(async () => {
      page.key(document.activeElement!, 'Enter')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(requests.find((r) => r.method === 'POST')!.body).toMatchObject({ to: 'inn' })
  })

  it('says it did not get an answer without claiming nothing was changed', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch
    const page = render(village, view([take(3)]))
    await click(page.buttons('Move…')[0])
    await click(option("Witch's hut"))
    await click(page.buttons('Move take 3')[0])
    expect(dialog()!.textContent).toContain(
      'Take 3 could not be moved: moving the take answered 500.',
    )
    expect(dialog()!.textContent).not.toContain('Nothing was changed')
  })

  it('greys Cancel and the button and says Moving… while the move is under way', async () => {
    let finish = (_: Response) => {}
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => (finish = resolve))) as unknown as typeof fetch
    const page = render(village, view([take(3)]))
    await click(page.buttons('Move…')[0])
    await click(option("Witch's hut"))
    await click(page.buttons('Move take 3')[0])
    expect(page.buttons('Moving…')[0]!.disabled).toBe(true)
    expect(page.buttons('Cancel')[0]!.disabled).toBe(true)
    await act(async () => {
      finish(new Response(JSON.stringify({ ok: true, n: 5 })))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(dialog()).toBeNull()
  })

  it('cancels with the button', async () => {
    const page = render(village, view([take(3)]))
    await click(page.buttons('Move…')[0])
    await click(page.buttons('Cancel')[0])
    expect(dialog()).toBeNull()
  })
})

describe('where a moved take came from', () => {
  it('is said under the take’s name on its card and in the In the game block', () => {
    const from = { title: 'Willowbrook village', n: 3 }
    render(
      row('hut', "Witch's hut", {
        status: 'chosen',
        current: { kind: 'take', take: 5, exists: true },
      }),
      view([take(4, { movedFrom: from }), take(5, { chosen: true, movedFrom: from })]),
    )
    const said = document.body.textContent!.split(
      'moved from Willowbrook village, where it was take 3',
    )
    expect(said).toHaveLength(3)
  })
})
