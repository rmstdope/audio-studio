import { afterAll, describe, expect, it } from 'bun:test'
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
  seconds: 6,
  bpm: null,
  key: null,
  game: { brief: 'fanfare', seconds: 6, bpm: null, key: null },
  status: 'chosen',
  changed: [],
  chosenAt: '2026-01-01T00:00:00.000Z',
  current: { kind: 'take', take: 1, exists: true },
  gameFile: null,
}

const take = (n: number, over: Partial<TakeView> = {}): TakeView => ({
  n,
  file: `0123456789abcdef.${n}.wav`,
  seconds: 4.2,
  peaks: Array.from({ length: 30 }, () => 0.5),
  earlier: false,
  chosen: false,
  model: 'Balanced',
  ...over,
})

function render(kind: 'loop' | 'stinger', takes: TakeView[], lockUnread = false) {
  const view: MusicTakesView = {
    ok: true,
    kind,
    generator: { ok: true },
    defaultModel: 'balanced',
    models: [{ id: 'balanced', installed: true }],
    takes,
    making: [],
    failed: [],
    lockUnread,
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(['music-takes', 'victory'], view)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(TakesPanel, { track, lists: [] }),
      ),
    ),
  )
  const fadesButtons = () =>
    [...container.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Fades…',
    ) as HTMLButtonElement[]
  return { container, fadesButtons }
}

describe('fading a stinger take on its page', () => {
  it('gives every card and the chosen take a Fades… button, at the left of the bottom row', () => {
    const { container, fadesButtons } = render('stinger', [
      take(1, { chosen: true }),
      take(2),
      take(3),
    ])
    expect(fadesButtons()).toHaveLength(3)
    const card = container.querySelectorAll('.take')[0]!
    const row = [...card.querySelectorAll('.take-row')].at(-1)!
    expect([...row.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Fades…',
      'Move…',
      'Drop',
      'Choose',
    ])
    const game = container.querySelector('.track-in-game')!
    const actions = [...game.querySelectorAll('.track-in-game-actions button')]
    expect(actions.map((b) => b.textContent)).toEqual(['Fades…', 'Un-choose'])
  })

  it('gives a loop nothing', () => {
    const { fadesButtons } = render('loop', [take(1, { chosen: true }), take(2)])
    expect(fadesButtons()).toHaveLength(0)
  })

  it('opens the editor in place, marks the take fading and greys every other Fades…', () => {
    const { container, fadesButtons } = render('stinger', [
      take(1, { chosen: true }),
      take(2),
      take(3),
    ])
    const [game, two, three] = fadesButtons() as [
      HTMLButtonElement,
      HTMLButtonElement,
      HTMLButtonElement,
    ]
    act(() => two.click())
    const card = container.querySelectorAll('.take')[0]!
    expect(card.textContent).toContain('fading')
    expect(card.querySelector('.editor')).not.toBeNull()
    expect([...card.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Choose')
    expect(document.activeElement?.closest('.editor')).not.toBeNull()
    const rest = fadesButtons()
    expect(rest).toHaveLength(2)
    for (const other of rest) {
      expect(other.getAttribute('aria-disabled')).toBe('true')
      expect(other.title).toBe('Close the fades of Take 2 first.')
    }
    // A greyed button opens nothing.
    act(() => three.click())
    expect(container.querySelectorAll('.editor')).toHaveLength(1)
    act(() => game.click())
    expect(container.querySelectorAll('.editor')).toHaveLength(1)
  })

  it('gives focus back to the take’s Fades… when the editor closes', () => {
    const { container, fadesButtons } = render('stinger', [take(1, { chosen: true }), take(2)])
    act(() => fadesButtons()[1]!.click())
    const cancel = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Cancel',
    )!
    act(() => cancel.click())
    expect(container.querySelector('.editor')).toBeNull()
    expect(document.activeElement?.textContent).toBe('Fades…')
    expect(document.activeElement).toBe(fadesButtons()[1]!)
  })

  it('opens the chosen take’s editor inside In the game, with the game’s hint', () => {
    const { container, fadesButtons } = render('stinger', [take(1, { chosen: true }), take(2)])
    act(() => fadesButtons()[0]!.click())
    const game = container.querySelector('.track-in-game')!
    expect(game.querySelector('.editor')).not.toBeNull()
    expect(game.textContent).toContain('Saving puts the faded sound in the game at once.')
  })

  it('marks the chosen take fading and takes its button row away while the editor is open', () => {
    const { container, fadesButtons } = render('stinger', [take(1, { chosen: true }), take(2)])
    act(() => fadesButtons()[0]!.click())
    const game = container.querySelector('.track-in-game')!
    expect(game.textContent).toContain('fading')
    const names = [...game.querySelectorAll('button')].map((b) => b.textContent)
    for (const gone of ['Fades…', 'Un-choose', 'Trim silence']) expect(names).not.toContain(gone)
    expect(game.querySelector('.track-in-game-actions')).toBeNull()
    const cancel = [...game.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!
    act(() => cancel.click())
    expect(game.textContent).not.toContain('fading')
    expect(game.querySelector('.track-in-game-actions')).not.toBeNull()
    expect(document.activeElement?.textContent).toBe('Fades…')
    expect(game.contains(document.activeElement)).toBe(true)
  })

  it('hides the Un-choose hint while the chosen take’s editor is open, and brings it back', () => {
    const { container, fadesButtons } = render('stinger', [take(1, { chosen: true }), take(2)])
    const game = container.querySelector('.track-in-game')!
    const unchooseHint = 'Un-choose and the game plays nothing here.'
    expect(game.textContent).toContain(unchooseHint)
    act(() => fadesButtons()[0]!.click())
    expect(game.textContent).not.toContain(unchooseHint)
    const cancel = [...game.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!
    act(() => cancel.click())
    expect(game.textContent).toContain(unchooseHint)
  })

  it('says one line under a take with fades, and nothing under one without', () => {
    const { container } = render('stinger', [
      take(1, { fades: { in: 0.3, out: 1.5, shape: 'smooth' } }),
      take(2, { fades: { in: 0, out: 1.5, shape: 'straight' } }),
      take(3),
    ])
    const cards = [...container.querySelectorAll('.take')]
    expect(cards[0]!.textContent).toContain('Fades in 0.3 s · out 1.5 s · smooth')
    expect(cards[0]!.querySelector('svg.env')).not.toBeNull()
    expect(cards[1]!.textContent).toContain('Fade out 1.5 s · straight')
    expect(cards[2]!.textContent).not.toMatch(/Fades? (in|out)/)
    expect(cards[2]!.querySelector('svg.env')).toBeNull()
  })

  it('greys Fades… while the music lock cannot be read, and says so', () => {
    const { container, fadesButtons } = render('stinger', [take(2), take(3)], true)
    expect(fadesButtons().every((b) => b.disabled)).toBe(true)
    expect(container.textContent).toContain(
      'Choosing, dropping, moving, trimming and fading wait until the music lock can be read. You can still listen and make more takes.',
    )
  })

  it('fades a trimmed take by the part between its cuts', () => {
    const { container, fadesButtons } = render('stinger', [
      take(2, { seconds: 6, trim: { start: 1, end: 0.9, seconds: 4.1 } }),
    ])
    act(() => fadesButtons()[0]!.click())
    const box = (label: string) =>
      [...container.querySelectorAll('label')]
        .find((l) => l.textContent?.startsWith(label))
        ?.querySelector('input') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    for (const [label, value] of [
      ['Fade in', '3'],
      ['Fade out', '3'],
    ] as const) {
      act(() => {
        setter.call(box(label), value)
        box(label).dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    expect(container.textContent).toContain(
      "The fades together can't be longer than the take (4.1 s).",
    )
    expect(
      container.querySelector('[aria-label="Fade in length"]')?.getAttribute('aria-valuemax'),
    ).toBe('4.1')
  })
})
