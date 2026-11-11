import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { EffectRow } from '../../../core/effects'
import type { EffectTakesView, EffectTakeView } from '../../../core/effectTakes'
import { installFakeWebAudio } from '../../../../test/fakeWebAudio'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { EffectTakesPanel } = await import('./EffectTakesPanel')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Whether a control is greyed: `aria-disabled`, so it still takes focus and shows its reason. */
const isOff = (element: Element) => element.getAttribute('aria-disabled') === 'true'

const realFetch = globalThis.fetch
const cleanups: (() => void)[] = []
afterEach(() => {
  globalThis.fetch = realFetch
  cleanups.splice(0).forEach((c) => c())
})
afterAll(() => GlobalRegistrator.unregister())

const MODEL = 'Stable Audio 3 Small SFX'
const take = (n: number, over: Partial<EffectTakeView> = {}): EffectTakeView => ({
  n,
  file: `0123456789abcdef.${n}.wav`,
  seconds: 1.4,
  peaks: [0.2, 0.8, 0.5],
  chosen: false,
  model: MODEL,
  loops: false,
  quietAt: null,
  ...over,
})
const view = (over: Partial<EffectTakesView> = {}): EffectTakesView => ({
  ok: true,
  canMake: true,
  projectModel: 'small-sfx',
  uv: true,
  models: [
    { id: 'small-sfx', download: 'whole', failed: false },
    { id: 'open-1', download: 'whole', failed: false },
  ],
  takes: [],
  making: [],
  failed: [],
  lockUnread: false,
  ...over,
})
const row = (over: Partial<EffectRow> = {}): EffectRow => ({
  id: 'chest-open',
  name: 'Chest open',
  description: 'a chest opens',
  gameDescription: 'a chest opens',
  seconds: 2,
  loops: false,
  changedHere: false,
  gameChanged: false,
  status: 'none-yet',
  current: { kind: 'nothing' },
  changed: [],
  chosen: false,
  ...over,
})
const chosenRow = (over: Partial<EffectRow> = {}) =>
  row({
    status: 'chosen',
    chosen: true,
    current: { kind: 'take', take: 2, exists: true },
    ...over,
  })

type Call = { url: string; method: string; body: string | null }

/** Renders the panel over `data`; every request is recorded and answered with `answer`. */
function render(
  effect: EffectRow,
  data: EffectTakesView,
  answer: (call: Call) => Response = () => Response.json({ ok: true }),
) {
  const calls: Call[] = []
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const call = {
      url: String(url),
      method: init?.method ?? 'GET',
      body: (init?.body as string) ?? null,
    }
    calls.push(call)
    return Promise.resolve(answer(call))
  }) as typeof fetch
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(['effect-takes', effect.id], data)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EffectTakesPanel, { row: effect }),
      ),
    ),
  )
  const text = () => container.textContent!.replace(/\s+/g, ' ')
  const buttons = (label: string) =>
    [...container.querySelectorAll('button')].filter((b) => b.textContent!.trim() === label)
  const button = (label: string) => buttons(label)[0]!
  const click = async (b: Element) => {
    await act(async () => (b as HTMLElement).click())
    await act(async () => void (await new Promise((r) => setTimeout(r, 5))))
  }
  return { container, calls, text, button, buttons, click }
}

const fades = { in: 0.02, out: 0.4, shape: 'smooth' as const }
const names = (parent: Element) => [...parent.querySelectorAll('button')].map((b) => b.textContent)

describe('Fades… on a sound effect take', () => {
  it('sits at the left of the bottom row of each take made to play once, before Choose and Drop, and of the take in the game', () => {
    const { container } = render(
      chosenRow(),
      view({ takes: [take(1), take(2, { chosen: true }), take(3)] }),
    )
    const cards = [...container.querySelectorAll('.take')]
    expect(cards).toHaveLength(2)
    for (const card of cards) {
      expect(names([...card.querySelectorAll('.take-row')].at(-1)!)).toEqual([
        'Fades…',
        'Drop',
        'Choose',
      ])
    }
    const game = container.querySelector('.track-in-game')!
    expect(names(game.querySelector('.track-in-game-actions')!)).toEqual(['Fades…', 'Un-choose'])
  })

  it('is not on a take made to loop, nor on any take of an effect that loops', () => {
    const once = render(
      chosenRow(),
      view({ takes: [take(1, { loops: true }), take(2, { chosen: true })] }),
    )
    expect(once.buttons('Fades…')).toHaveLength(1)
    const loops = render(
      chosenRow({ loops: true }),
      view({ takes: [take(1, { loops: true }), take(2, { loops: true, chosen: true })] }),
    )
    expect(loops.buttons('Fades…')).toHaveLength(0)
    const leftover = render(
      chosenRow({ loops: true }),
      view({ takes: [take(1, { fades }), take(2, { chosen: true, fades })] }),
    )
    expect(leftover.buttons('Fades…')).toHaveLength(0)
    expect(leftover.container.querySelectorAll('svg.env')).toHaveLength(0)
    expect(leftover.text()).not.toMatch(/Fades? (in|out)/)
  })

  it('opens the editor in place with the fading chip and focus in Fade in, and greys every other Fades…', () => {
    const { container, buttons } = render(
      chosenRow(),
      view({ takes: [take(1), take(2, { chosen: true }), take(3)] }),
    )
    const one = buttons('Fades…')[2]!
    act(() => buttons('Fades…')[1]!.click())
    const card = [...container.querySelectorAll('.take')].find((c) => c.querySelector('.editor'))!
    expect(card.textContent).toContain('Take 1')
    expect(card.textContent).toContain('fading')
    expect(card.textContent).toContain('Hear it with the fades')
    expect(card.textContent).toContain('Drag the handles or type a length; 0 is no fade.')
    expect(names(card)).not.toContain('Choose')
    expect(names(card)).not.toContain('Drop')
    expect(card.textContent).not.toContain('The chosen, then this')
    const active = document.activeElement as HTMLInputElement
    expect(active.closest('.editor')).not.toBeNull()
    expect(active.type).toBe('number')
    for (const other of buttons('Fades…')) {
      expect(other.getAttribute('aria-disabled')).toBe('true')
      expect(other.dataset.why).toBe('Close the fades of Take 1 first.')
    }
    act(() => one.click())
    expect(container.querySelectorAll('.editor')).toHaveLength(1)
  })

  it('steps the lengths by a hundredth of a second', () => {
    const { container, buttons } = render(
      chosenRow(),
      view({ takes: [take(1), take(2, { chosen: true })] }),
    )
    act(() => buttons('Fades…')[1]!.click())
    const box = container.querySelector<HTMLInputElement>('.editor input[type="number"]')!
    expect(box.step).toBe('0.01')
    const handle = container.querySelector('.editor [aria-label="Fade in length"]')!
    act(() => {
      handle.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      )
    })
    expect(box.value).toBe('0.01')
    act(() => {
      handle.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
      )
    })
    expect(box.value).toBe('0.11')
  })

  it('saves the fades on the take, closes, and gives focus back to its Fades…', async () => {
    const { container, buttons, calls, click } = render(
      chosenRow(),
      view({ takes: [take(1), take(2, { chosen: true })] }),
    )
    await click(buttons('Fades…')[1]!)
    const box = container.querySelector<HTMLInputElement>('.editor input[type="number"]')!
    expect(buttons('Save fades')[0]!.getAttribute('aria-disabled')).toBe('true')
    expect(buttons('Remove fades')).toHaveLength(0)
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      set.call(box, '0.01')
      box.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    await click(buttons('Save fades')[0]!)
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.url).toBe(`/api/effects/chest-open/takes/${take(1).file}/fades`)
    expect(JSON.parse(put.body!)).toEqual({ in: 0.01, out: 0, shape: 'smooth' })
    expect(container.querySelector('.editor')).toBeNull()
    expect(document.activeElement?.textContent).toBe('Fades…')
    expect(document.activeElement?.closest('.take')?.textContent).toContain('Take 1')
  })

  it('removes the fades in one press, with no question', async () => {
    const { container, buttons, calls, click } = render(
      chosenRow(),
      view({ takes: [take(1, { fades }), take(2, { chosen: true })] }),
    )
    await click(buttons('Fades…')[1]!)
    await click(buttons('Remove fades')[0]!)
    expect(calls.find((c) => c.method === 'DELETE')!.url).toBe(
      `/api/effects/chest-open/takes/${take(1).file}/fades`,
    )
    expect(container.querySelector('.editor')).toBeNull()
  })

  it('says why a save failed, above the hint, with the editor still open', async () => {
    const { container, buttons, click, text } = render(
      chosenRow(),
      view({ takes: [take(1, { fades }), take(2, { chosen: true })] }),
      () => Response.json({ ok: false, message: 'The disk is full.' }, { status: 409 }),
    )
    await click(buttons('Fades…')[1]!)
    await click(buttons('Remove fades')[0]!)
    expect(container.querySelector('.editor')).not.toBeNull()
    expect(text()).toContain('The fades could not be removed. The disk is full.')
    expect(text()).not.toContain('The game still plays')
  })

  it('opens the take in the game’s editor inside the block, hiding Un-choose and its line, and writes the game', async () => {
    const { container, buttons, calls, click } = render(
      chosenRow(),
      view({ takes: [take(1), take(2, { chosen: true, fades })] }),
      () => Response.json({ ok: false, message: 'The disk is full.' }, { status: 409 }),
    )
    const game = container.querySelector('.track-in-game')!
    expect(game.textContent).toContain('Un-choose and the game plays nothing here.')
    await click(buttons('Fades…')[0]!)
    expect(game.querySelector('.editor')).not.toBeNull()
    expect(game.textContent).toContain('fading')
    expect(game.textContent).toContain('Saving puts the faded sound in the game at once.')
    expect(game.textContent).not.toContain('Un-choose')
    expect(game.querySelector('.track-in-game-actions')).toBeNull()
    await click(buttons('Remove fades')[0]!)
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true)
    expect(game.textContent).toContain(
      'The fades could not be removed. The disk is full. The game still plays Take 2 with its fades.',
    )
    await click(buttons('Cancel')[0]!)
    expect(game.querySelector('.track-in-game-actions')).not.toBeNull()
    expect(game.contains(document.activeElement)).toBe(true)
    expect(document.activeElement?.textContent).toBe('Fades…')
  })

  it('puts the chosen take’s fades line under its waveform in the In the game block', () => {
    const { container } = render(chosenRow(), view({ takes: [take(2, { chosen: true, fades })] }))
    const game = container.querySelector('.track-in-game')!
    const line = [...game.querySelectorAll('span')].find((e) =>
      e.textContent?.startsWith('Fades in 0.02 s'),
    )!
    const wave = game.querySelector('.wave')!
    expect(wave.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says one line under a take with fades and draws the fade line, and nothing under one without', () => {
    const { container } = render(
      chosenRow(),
      view({
        takes: [
          take(1, { fades }),
          take(3, { fades: { in: 0.01, out: 0, shape: 'straight' } }),
          take(4, { fades: { in: 0, out: 0.25, shape: 'smooth' } }),
          take(5),
          take(2, { chosen: true, fades }),
        ],
      }),
    )
    const cards = [...container.querySelectorAll('.take')]
    expect(cards[0]!.textContent).toContain('Fades in 0.02 s · out 0.4 s · smooth')
    expect(cards[0]!.querySelector('svg.env')).not.toBeNull()
    expect(cards[1]!.textContent).toContain('Fade in 0.01 s · straight')
    expect(cards[2]!.textContent).toContain('Fade out 0.25 s · smooth')
    expect(cards[3]!.textContent).not.toMatch(/Fades? (in|out)/)
    expect(cards[3]!.querySelector('svg.env')).toBeNull()
    expect(container.querySelector('.track-in-game')!.textContent).toContain(
      'Fades in 0.02 s · out 0.4 s · smooth',
    )
  })

  it('plays a take with its saved fades, in the card and in the game block', async () => {
    cleanups.push(installFakeWebAudio())
    // What each play asks the player for: the fake audio element keeps no history of its own.
    const srcs: string[] = []
    const Fake = globalThis.Audio as unknown as new () => object
    globalThis.Audio = class extends Fake {
      constructor() {
        super()
        let src = ''
        Object.defineProperty(this, 'src', {
          get: () => src,
          set: (value: string) => {
            src = value
            srcs.push(value)
          },
        })
      }
    } as unknown as typeof Audio
    const { click, container } = render(
      chosenRow(),
      view({ takes: [take(1, { fades }), take(2, { chosen: true, fades }), take(3)] }),
    )
    const play = (n: number) =>
      container.querySelector<HTMLButtonElement>(`button[aria-label="Play take ${n}"]`)!
    await click(play(1))
    await click(play(2))
    await click(play(3))
    expect(srcs).toEqual([
      `/api/effects/chest-open/takes/${take(1).file}?fadeIn=0.02&fadeOut=0.4&shape=smooth`,
      `/api/effects/chest-open/takes/${take(2).file}?fadeIn=0.02&fadeOut=0.4&shape=smooth`,
      `/api/effects/chest-open/takes/${take(3).file}`,
    ])
  })

  it('greys Fades… with Choose and Drop while the lock cannot be read, and says fading too', () => {
    const { buttons, text } = render(
      chosenRow(),
      view({ takes: [take(1), take(3)], lockUnread: true }),
    )
    expect(buttons('Fades…').every(isOff)).toBe(true)
    expect(text()).toContain(
      'Choosing, dropping and fading wait until the sound effects lock can be read. You can still listen and make more takes.',
    )
  })

  it('closes on Escape and gives focus back', async () => {
    const { container, buttons, click } = render(
      chosenRow(),
      view({ takes: [take(1, { fades }), take(2, { chosen: true })] }),
    )
    await click(buttons('Fades…')[1]!)
    const editor = container.querySelector('.editor')!
    act(() => {
      editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('.editor')).toBeNull()
    expect(document.activeElement?.textContent).toBe('Fades…')
    expect(document.activeElement?.closest('.take')?.textContent).toContain('Take 1')
  })
})
