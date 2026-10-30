import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { TrackRow } from '../../../core/music'
import type { MusicTakesView, TakeView } from '../../../core/musicTake'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { TakesPanel } = await import('./TakesPanel')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterAll(() => {
  cleanups.forEach((c) => c())
  GlobalRegistrator.unregister()
})

const GAME_FILE = 'assets/music/freetouse/willowbrook-village.mp3'

const row = (over: Partial<TrackRow> = {}): TrackRow => ({
  id: 'hall',
  title: 'Lantern hall',
  plays: null,
  brief: 'A brief',
  seconds: 30,
  bpm: null,
  key: null,
  game: { brief: 'A brief', seconds: 30, bpm: null, key: null },
  status: 'chosen',
  changed: [],
  chosenAt: '2026-10-01T10:00:00.000Z',
  current: { kind: 'take', take: 3, exists: true },
  gameFile: { file: GAME_FILE, exists: true },
  ...over,
})

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

const view = (takes: TakeView[]): MusicTakesView => ({
  ok: true,
  kind: 'loop',
  generator: { ok: true },
  defaultModel: 'balanced',
  models: [{ id: 'balanced', installed: true }],
  takes,
  making: [],
  failed: [],
  lockUnread: false,
})

let answer: unknown
const requests: { url: string; method: string }[] = []
beforeEach(() => {
  answer = { ok: true }
  requests.length = 0
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    requests.push({ url: String(url), method: init?.method ?? 'GET' })
    return new Response(JSON.stringify(answer))
  }) as typeof fetch
})

function render(track: TrackRow, takes: TakeView[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(['music-takes', 'hall'], view(takes))
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  const show = (track: TrackRow) =>
    act(() =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(TakesPanel, { track, lists: [] }),
        ),
      ),
    )
  show(track)
  const button = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === name)
  const block = () => container.querySelector('[aria-label="In the game"]')
  return { container, button, block, rerender: show }
}

async function click(button: HTMLButtonElement | undefined) {
  await act(async () => {
    button!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('the In the game block', () => {
  it('shows the chosen take on its own, and leaves it out of the takes below', () => {
    const page = render(row(), [take(1), take(3, { chosen: true }), take(2)])
    const block = page.block()!
    expect(block.textContent).toContain('In the game')
    expect(block.textContent).toContain('Take 3')
    expect(block.textContent).toContain('chosen')
    expect(block.textContent).toContain('Un-choose and the game goes back to its own file.')
    expect(block.querySelector('.wave')).not.toBeNull()
    const cards = [...page.container.querySelectorAll('.takes .take b')].map((b) => b.textContent)
    expect(cards).toEqual(['Take 1', 'Take 2'])
  })

  it('says the game plays nothing when there is no file of its own', () => {
    const page = render(row({ gameFile: null }), [take(3, { chosen: true }), take(1)])
    expect(page.block()!.textContent).toContain('Un-choose and the game plays nothing here.')
  })

  it('says the music lock could not be read, not the game’s own file, without Un-choose', () => {
    const page = render(
      row({ status: 'not-chosen', chosenAt: null, current: { kind: 'unknown' } }),
      [take(1), take(3)],
    )
    const block = page.block()!
    expect(block.textContent).not.toContain("The game's own file")
    expect(block.textContent).toContain('The music lock could not be read')
    expect(page.button('Un-choose')).toBeUndefined()
  })

  it('shows the game’s own file, without Un-choose, when no take is chosen', () => {
    const page = render(
      row({
        status: 'not-chosen',
        chosenAt: null,
        current: { kind: 'game', file: GAME_FILE, exists: true },
      }),
      [take(1)],
    )
    const block = page.block()!
    expect(block.textContent).toContain("The game's own file")
    expect(block.textContent).toContain(GAME_FILE)
    expect(block.textContent).toContain('Choose a take below and the game plays it instead.')
    expect(page.button('Un-choose')).toBeUndefined()
    expect(block.querySelector('.wave')).toBeNull()
  })

  it('marks a game file that is not on disk, with no play button', () => {
    const page = render(
      row({
        status: 'not-chosen',
        current: { kind: 'game', file: GAME_FILE, exists: false },
        gameFile: { file: GAME_FILE, exists: false },
      }),
      [],
    )
    const block = page.block()!
    expect(block.className).toContain('track-in-game-warn')
    expect(block.textContent).toContain('The file is not there.')
    expect(block.querySelector('.play')).toBeNull()
  })

  it('is shown dashed on a brand-new track, above the No takes yet card', () => {
    const page = render(
      row({ status: 'not-chosen', current: { kind: 'none' }, gameFile: null }),
      [],
    )
    const block = page.block()!
    expect(block.className).toContain('track-in-game-none')
    expect(block.textContent).toContain('Nothing plays here yet')
    expect(block.textContent).toContain('Choose a take below and the game plays it.')
    expect(page.container.textContent).toContain('No takes yet')
  })

  it('shows No other takes yet when the chosen take is the only one', () => {
    const page = render(row(), [take(3, { chosen: true })])
    expect(page.container.textContent).toContain('No other takes yet')
    expect(page.container.textContent).toContain('Make a few more to compare with the chosen one.')
    expect(page.button('Make 2 takes')).toBeDefined()
  })

  it('turns amber with Choose again when the chosen take’s music file is gone', async () => {
    const page = render(
      row({ status: 'missing', current: { kind: 'take', take: 3, exists: false } }),
      [take(3, { chosen: true })],
    )
    const block = page.block()!
    expect(block.className).toContain('track-in-game-warn')
    expect(block.textContent).toContain('music file missing')
    await click(page.button('Choose again'))
    expect(requests.at(0)).toMatchObject({ method: 'POST' })
    expect(requests.at(0)!.url).toContain('/choose')
  })
})

describe('Un-choose', () => {
  const chosen = () => render(row(), [take(3, { chosen: true }), take(1)])

  it('asks first, in place of the block, with focus on its Un-choose', async () => {
    const page = chosen()
    await click(page.button('Un-choose'))
    expect(page.block()).toBeNull()
    const question = page.container.querySelector('[role="alertdialog"]')!
    expect(question.textContent).toContain('Un-choose Take 3?')
    expect(question.textContent).toContain(
      `The game goes back to its own file (${GAME_FILE}). Take 3's music file is deleted from the game; Take 3 stays with the other takes, to be chosen again.`,
    )
    expect(document.activeElement).toBe(page.button('Un-choose') ?? null)
    expect(requests.filter((r) => r.method === 'POST')).toEqual([])
  })

  it('puts the block back on Cancel, with focus on its Un-choose', async () => {
    const page = chosen()
    await click(page.button('Un-choose'))
    await click(page.button('Cancel'))
    expect(page.block()).not.toBeNull()
    expect(document.activeElement).toBe(page.button('Un-choose') ?? null)
    expect(requests.filter((r) => r.method === 'POST')).toEqual([])
  })

  it('puts the block back on Esc', async () => {
    const page = chosen()
    await click(page.button('Un-choose'))
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(page.block()).not.toBeNull()
    expect(document.activeElement).toBe(page.button('Un-choose') ?? null)
  })

  it('un-chooses on the question’s Un-choose', async () => {
    const page = chosen()
    await click(page.button('Un-choose'))
    await click(page.button('Un-choose'))
    const post = requests.find((r) => r.method === 'POST')!
    expect(post.url).toBe('/api/music/tracks/hall/unchoose')
  })

  it('un-chooses, closes the question and puts focus on the block', async () => {
    const page = chosen()
    await click(page.button('Un-choose'))
    await click(page.button('Un-choose'))
    expect(page.container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(document.activeElement).toBe(page.block())
  })

  it('keeps the block and says why when the server answers an error', async () => {
    globalThis.fetch = (async (_url: unknown, _init?: RequestInit) =>
      new Response('boom', { status: 500 })) as typeof fetch
    const page = chosen()
    await click(page.button('Un-choose'))
    await click(page.button('Un-choose'))
    expect(page.container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(page.block()!.textContent).toContain('Take 3 could not be un-chosen:')
    expect(page.block()!.textContent).toContain('Nothing was changed.')
    expect(document.activeElement).toBe(page.button('Un-choose') ?? null)
  })

  it('keeps the block and says why when it failed', async () => {
    answer = { ok: false, message: 'The disk is full.' }
    const page = chosen()
    await click(page.button('Un-choose'))
    await click(page.button('Un-choose'))
    const block = page.block()!
    expect(block.textContent).toContain(
      'Take 3 could not be un-chosen: the disk is full. Nothing was changed.',
    )
  })

  it('says why, with focus on the block, when refused for a lock that cannot be read', async () => {
    const refusal = { ok: false, message: 'The music lock could not be read.' }
    let answerNow = () => {}
    globalThis.fetch = (async (_url: unknown, _init?: RequestInit) => {
      await new Promise<void>((resolve) => (answerNow = resolve))
      return new Response(JSON.stringify(refusal), { status: 409 })
    }) as typeof fetch
    const page = chosen()
    await click(page.button('Un-choose'))
    await click(page.button('Un-choose'))
    // The page re-reads the project before the question closes: with the lock unreadable, what
    // plays is not known, and the block has no Un-choose to give focus back to.
    page.rerender(row({ status: 'not-chosen', chosenAt: null, current: { kind: 'unknown' } }))
    await act(async () => {
      answerNow()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const block = page.block()!
    expect(block.textContent).toContain('The music lock could not be read')
    expect(block.textContent).toContain(
      'Take 3 could not be un-chosen: the music lock could not be read. Nothing was changed.',
    )
    expect(document.activeElement).toBe(block)
  })

  it('names the file of a refusal that carries no message, never the lock', async () => {
    answer = { ok: false, file: 'content-studio.json', problems: [] }
    const page = chosen()
    await click(page.button('Un-choose'))
    await click(page.button('Un-choose'))
    expect(page.block()!.textContent).toContain(
      'Take 3 could not be un-chosen: content-studio.json could not be read. Nothing was changed.',
    )
  })

  it('names the music manifest when it is the file that could not be read', async () => {
    answer = { ok: false, message: 'The music manifest could not be read.' }
    const page = chosen()
    await click(page.button('Un-choose'))
    await click(page.button('Un-choose'))
    expect(page.block()!.textContent).toContain(
      'Take 3 could not be un-chosen: the music manifest could not be read. Nothing was changed.',
    )
  })
})
