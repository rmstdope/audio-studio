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

const track: TrackRow = {
  id: 'victory',
  title: 'Victory',
  plays: null,
  brief: 'fanfare',
  seconds: 10,
  bpm: null,
  key: null,
  game: { brief: 'fanfare', seconds: 10, bpm: null, key: null },
  status: 'not-chosen',
  changed: [],
  chosenAt: null,
  current: { kind: 'none' },
  gameFile: null,
}
const inGameRow: TrackRow = {
  ...track,
  status: 'chosen',
  current: { kind: 'take', take: 9, exists: true },
}

const take = (n: number, over: Partial<TakeView> = {}): TakeView => ({
  n,
  file: `aaaaaaaaaaaaaaaa.${n}.wav`,
  seconds: 10,
  seed: n,
  peaks: Array.from({ length: 20 }, () => 0.5),
  earlier: false,
  chosen: false,
  model: 'Balanced · XL turbo · 4B',
  trimmable: 'cut',
  ...over,
})
const view = (takes: TakeView[]): MusicTakesView => ({
  ok: true,
  kind: 'stinger',
  generator: { ok: true },
  defaultModel: 'balanced',
  models: [{ id: 'balanced', installed: true }],
  takes,
  making: [],
  failed: [],
  lockUnread: false,
})

const WRITE = 'The game’s file could not be written.'
/** Posts whose path ends in one of these are refused; the rest succeed. */
let refuse: string[]
beforeEach(() => {
  refuse = []
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (!init?.method || init.method === 'GET') return new Response('{}')
    const path = String(url)
    if (refuse.some((r) => path.endsWith(r)))
      return new Response(JSON.stringify({ ok: false, message: WRITE }), { status: 409 })
    return new Response(JSON.stringify({ ok: true }))
  }) as typeof fetch
})

function render(data: MusicTakesView, row: TrackRow = track) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(['music-takes', 'victory'], data)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(TakesPanel, { track: row, lists: [] }),
      ),
    ),
  )
  /** The button with this text within the nth take card (0-based), or the whole page. */
  const button = (name: string, card?: number) => {
    const scope = card === undefined ? container : container.querySelectorAll('.take')[card]!
    return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === name,
    )!
  }
  const lines = () => [...container.querySelectorAll('.adopt-error')].map((e) => e.textContent)
  return { container, button, lines }
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('a track shows only the red line of the action pressed last', () => {
  it('drops Take 1’s line once Choose on Take 3 succeeds', async () => {
    const { button, lines } = render(view([take(1), take(2), take(3)]))
    refuse = ['/choose']
    await click(button('Choose', 0))
    expect(lines()).toEqual([WRITE])
    refuse = []
    await click(button('Choose', 2))
    expect(lines()).toEqual([])
  })

  it('shows only the newest of two failures in a row', async () => {
    const { button, container, lines } = render(view([take(1), take(2)]))
    refuse = ['/choose']
    await click(button('Choose', 0))
    await click(button('Choose', 1))
    expect(lines()).toEqual([WRITE])
    expect(container.querySelectorAll('.take')[0]!.querySelector('.adopt-error')).toBeNull()
  })

  it('drops a Choose failure when another kind of action succeeds, and vice versa', async () => {
    const { button, lines } = render(view([take(1), take(2)]))
    refuse = ['/choose']
    await click(button('Choose', 0))
    refuse = []
    await click(button('Trim silence', 1))
    expect(lines()).toEqual([])
    refuse = ['/trim']
    await click(button('Trim silence', 1))
    expect(lines()).toHaveLength(1)
    refuse = []
    await click(button('Drop', 0))
    expect(lines()).toEqual([])
  })

  it('clears the old line of the take in the game when a card’s action is pressed', async () => {
    const { button, container, lines } = render(
      view([take(9, { chosen: true }), take(1)]),
      inGameRow,
    )
    refuse = ['/trim']
    await click(container.querySelector<HTMLButtonElement>('.track-in-game .btn-small')!)
    expect(lines()).toHaveLength(1)
    refuse = []
    await click(button('Choose', 0))
    expect(lines()).toEqual([])
  })

  it('keeps the old line when Fades… is opened and cancelled', async () => {
    const { button, lines } = render(view([take(1), take(2)]))
    refuse = ['/choose']
    await click(button('Choose', 0))
    await click(button('Fades…', 1))
    await click(button('Cancel'))
    expect(lines()).toEqual([WRITE])
  })

  it('leaves only the editor’s line when Save fades fails after an old failure', async () => {
    const { button, container, lines } = render(view([take(1), take(2)]))
    refuse = ['/choose']
    await click(button('Choose', 0))
    refuse = ['/fades']
    await click(button('Fades…', 1))
    const box = container.querySelector<HTMLInputElement>('.editor input[type="number"]')!
    await act(async () => {
      // React tracks the value through the prototype's setter.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, '0.5')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(button('Save fades'))
    expect(lines()).toHaveLength(1)
    expect(lines()[0]).toContain('The fades could not be saved.')
  })

  it('keeps the take in the game’s line when its Un-choose question is cancelled, and drops it when confirmed', async () => {
    const { button, container, lines } = render(view([take(9, { chosen: true })]), inGameRow)
    refuse = ['/trim']
    await click(container.querySelector<HTMLButtonElement>('.track-in-game .btn-small')!)
    expect(lines()).toHaveLength(1)
    await click(button('Un-choose'))
    await click(button('Cancel'))
    expect(lines()).toHaveLength(1)
    await click(button('Un-choose'))
    await click(
      [...container.querySelectorAll<HTMLButtonElement>('.btn-primary')].find(
        (b) => b.textContent === 'Un-choose',
      )!,
    )
    expect(lines()).toEqual([])
  })

  it('leaves only the editor’s line when Save fades fails on the take in the game', async () => {
    const { button, container, lines } = render(view([take(9, { chosen: true })]), inGameRow)
    refuse = ['/trim', '/fades']
    await click(container.querySelector<HTMLButtonElement>('.track-in-game .btn-small')!)
    await click(button('Fades…'))
    const box = container.querySelector<HTMLInputElement>('.editor input[type="number"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, '0.5')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(button('Save fades'))
    expect(lines()).toHaveLength(1)
    expect(lines()[0]).toContain('The fades could not be saved.')
  })

  it('hides a failed Drop’s line when a later action is pressed', async () => {
    const { button, lines } = render(view([take(1), take(2)]))
    refuse = ['.1.wav']
    await click(button('Drop', 0))
    expect(lines()).toHaveLength(1)
    refuse = []
    await click(button('Trim silence', 1))
    expect(lines()).toEqual([])
  })

  it('hides a failed Un-choose’s line when a later action is pressed', async () => {
    const { button, container, lines } = render(
      view([take(9, { chosen: true }), take(1)]),
      inGameRow,
    )
    refuse = ['/unchoose']
    await click(button('Un-choose'))
    await click(
      [...container.querySelectorAll<HTMLButtonElement>('.btn-primary')].find(
        (b) => b.textContent === 'Un-choose',
      )!,
    )
    expect(lines()).toHaveLength(1)
    refuse = []
    await click(button('Choose', 0))
    expect(lines()).toEqual([])
  })

  it('has dropped the old line while the new action is still working', async () => {
    const { button, lines } = render(view([take(1), take(2)]))
    refuse = ['/choose']
    await click(button('Choose', 0))
    expect(lines()).toHaveLength(1)
    const ok = globalThis.fetch
    let release: () => void = () => {}
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      await new Promise<void>((resolve) => (release = resolve))
      return ok(...args)
    }) as typeof fetch
    refuse = []
    await click(button('Trim silence', 1))
    expect(button('Trimming…', 1)).toBeDefined()
    expect(lines()).toEqual([])
    await act(async () => {
      release()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  })

  it('leaves another track’s page alone', async () => {
    const a = render(view([take(1)]))
    const b = render(view([take(1)]))
    refuse = ['/choose']
    await click(a.button('Choose', 0))
    refuse = []
    await click(b.button('Choose', 0))
    expect(a.lines()).toHaveLength(1)
    expect(b.lines()).toEqual([])
  })

  it('leaves no line on a track after a reload', async () => {
    const first = render(view([take(1)]))
    refuse = ['/choose']
    await click(first.button('Choose', 0))
    expect(first.lines()).toHaveLength(1)
    const again = render(view([take(1)]))
    expect(again.lines()).toEqual([])
  })
})
