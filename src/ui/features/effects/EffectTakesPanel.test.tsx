import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { EffectRow } from '../../../core/effects'
import type { EffectTakesView, EffectTakeView } from '../../../core/effectTakes'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { EffectTakesPanel } = await import('./EffectTakesPanel')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
  generator: { ok: true },
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

describe('a new effect', () => {
  it('shows the dashed block and the empty card with the menu and Make 4 takes', () => {
    const { container, text, button } = render(row(), view())
    expect(container.querySelector('.track-in-game-none')).not.toBeNull()
    expect(text()).toContain('In the game')
    expect(text()).toContain('Nothing plays here yet')
    expect(text()).toContain('Choose a take below and the game plays it.')
    expect(text()).toContain('No takes yet')
    expect(text()).toContain(
      'Each take is a new sound made from the description, about 2 seconds each.',
    )
    expect(text()).toContain('Make a few, listen, and choose the one the game plays.')
    expect(button('Make 4 takes').disabled).toBe(false)
    const menu = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Number of new takes"]',
    )!
    expect([...menu.options].map((o) => o.textContent)).toEqual([
      '1 take',
      '2 takes',
      '3 takes',
      '4 takes',
      '5 takes',
      '6 takes',
      '7 takes',
      '8 takes',
    ])
    expect(menu.value).toBe('4')
  })

  it('asks for the number of takes the menu says', async () => {
    const { container, calls, button, click } = render(row(), view())
    const menu = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Number of new takes"]',
    )!
    await act(async () => {
      menu.value = '2'
      menu.dispatchEvent(new window.Event('change', { bubbles: true }))
    })
    expect(button('Make 2 takes')).toBeDefined()
    await click(button('Make 2 takes'))
    expect(calls[0]).toMatchObject({ url: '/api/effects/chest-open/takes', method: 'POST' })
    expect(JSON.parse(calls[0]!.body!)).toEqual({ count: 2 })
  })
})

describe('takes made, none chosen', () => {
  const data = view({ takes: [take(1), take(2, { seconds: 1.8 }), take(3)] })

  it('lists the takes in number order with Choose and Drop, and no comparison', () => {
    const { container, text, buttons } = render(row({ status: 'not-chosen' }), data)
    const cards = [...container.querySelectorAll('.take')]
    expect(cards.map((c) => c.querySelector('b')!.textContent)).toEqual([
      'Take 1',
      'Take 2',
      'Take 3',
    ])
    expect(cards[1]!.textContent).toContain(MODEL)
    expect(cards[1]!.textContent).toContain('1.8 s')
    expect(buttons('Choose')).toHaveLength(3)
    expect(buttons('Drop')).toHaveLength(3)
    expect(text()).not.toContain('The chosen, then this')
    expect(text()).toContain('Make 4 more takes')
    expect(container.querySelector('.track-in-game-none')).not.toBeNull()
  })

  it('chooses a take at once, without asking', async () => {
    const { container, calls, click, buttons } = render(row({ status: 'not-chosen' }), data)
    await click(buttons('Choose')[1]!)
    expect(calls[0]).toMatchObject({ url: '/api/effects/chest-open/choose', method: 'POST' })
    expect(JSON.parse(calls[0]!.body!)).toEqual({ file: take(2).file })
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('drops a take at once, without asking', async () => {
    const { calls, click, buttons } = render(row({ status: 'not-chosen' }), data)
    await click(buttons('Drop')[0]!)
    expect(calls[0]).toMatchObject({
      url: `/api/effects/chest-open/takes/${take(1).file}`,
      method: 'DELETE',
    })
  })

  it('says where choosing and dropping failed, and changes nothing else', async () => {
    const refuse = () => Response.json({ ok: false, message: 'nope' }, { status: 409 })
    const { text, click, buttons } = render(row({ status: 'not-chosen' }), data, refuse)
    await click(buttons('Choose')[0]!)
    expect(text()).toContain('The take could not be chosen.')
    await click(buttons('Drop')[1]!)
    expect(text()).toContain('The take could not be dropped.')
  })
})

describe('a take chosen', () => {
  const data = view({ takes: [take(1), take(2, { chosen: true }), take(3)] })

  it('shows the chosen take on its own, the others as cards, and a comparison on each', () => {
    const { container, text, buttons } = render(chosenRow(), data)
    const block = container.querySelector('[aria-label="In the game"]')!
    expect(block.textContent).toContain('In the game')
    expect(block.textContent).toContain('Take 2')
    expect(block.textContent).toContain('chosen')
    expect(block.textContent).toContain(MODEL)
    expect(block.textContent).toContain('Un-choose and the game plays nothing here.')
    expect(
      [...container.querySelectorAll('.takes .take')].map((c) => c.querySelector('b')!.textContent),
    ).toEqual(['Take 1', 'Take 3'])
    expect(buttons('▶ The chosen, then this')).toHaveLength(2)
    expect(text()).toContain('Make 4 more takes')
  })

  it('compares: the button reads ■ Stop while it plays and ■ Stop again puts it back', async () => {
    const { click, buttons } = render(chosenRow(), data)
    await click(buttons('▶ The chosen, then this')[0]!)
    // Only the pressed card reads Stop.
    expect(buttons('■ Stop')).toHaveLength(1)
    await click(buttons('■ Stop')[0]!)
    expect(buttons('■ Stop')).toHaveLength(0)
    expect(buttons('▶ The chosen, then this')).toHaveLength(2)
  })

  it('says there are no other takes when the chosen one is the only take', () => {
    const { text, button } = render(chosenRow(), view({ takes: [take(2, { chosen: true })] }))
    expect(text()).toContain('No other takes yet')
    expect(text()).toContain('Make a few more to compare with the chosen one.')
    expect(button('Make 4 takes')).toBeDefined()
  })
})

describe('Un-choose', () => {
  const data = view({ takes: [take(1), take(2, { chosen: true })] })

  it('asks first, in place of the block, with focus on its Un-choose; Cancel puts the block back with focus on Un-choose', async () => {
    const { container, text, button, click, calls } = render(chosenRow(), data)
    await click(button('Un-choose'))
    const dialog = container.querySelector('[role="alertdialog"]')!
    expect(dialog.textContent).toContain('Un-choose Take 2?')
    expect(dialog.textContent).toContain(
      "The game plays nothing here until another take is chosen. Take 2's clip is deleted from the game; Take 2 stays with the other takes, to be chosen again.",
    )
    expect(container.querySelector('[aria-label="In the game"]')).toBeNull()
    expect(document.activeElement!.textContent).toBe('Un-choose')
    await click(button('Cancel'))
    expect(calls).toHaveLength(0)
    expect(text()).toContain('Take 2')
    expect(document.activeElement!.textContent).toBe('Un-choose')
  })

  it('Escape cancels', async () => {
    const { container, button, click } = render(chosenRow(), data)
    await click(button('Un-choose'))
    await act(async () => {
      container
        .querySelector('[role="alertdialog"]')!
        .dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('un-chooses on the second Un-choose', async () => {
    const { container, calls, click } = render(chosenRow(), data)
    await click(
      container.querySelector<HTMLButtonElement>('[aria-label="In the game"] button.btn-small')!,
    )
    await click(container.querySelector<HTMLButtonElement>('[role="alertdialog"] .btn-primary')!)
    expect(calls[0]).toMatchObject({ url: '/api/effects/chest-open/unchoose', method: 'POST' })
  })

  it('names the take and the reason when it fails, and leaves the block', async () => {
    const refuse = () =>
      Response.json(
        { ok: false, message: 'The sound effects lock could not be read.' },
        { status: 409 },
      )
    const { container, text, click } = render(chosenRow(), data, refuse)
    await click(
      container.querySelector<HTMLButtonElement>('[aria-label="In the game"] button.btn-small')!,
    )
    await click(container.querySelector<HTMLButtonElement>('[role="alertdialog"] .btn-primary')!)
    expect(text()).toContain(
      'Take 2 could not be un-chosen: the sound effects lock could not be read. Nothing was changed.',
    )
    expect(container.querySelector('[aria-label="In the game"]')).not.toBeNull()
  })
})

describe('out of date', () => {
  const data = view({ takes: [take(2, { chosen: true })] })

  it('offers Accept when only the description changed, and accepting asks the studio', async () => {
    const { text, button, click, calls } = render(
      chosenRow({ status: 'changed', changed: ['description'] }),
      data,
    )
    expect(text()).toContain('Changed since its take was chosen: description.')
    expect(text()).toContain(
      'Make more takes to hear the new description, or Accept to count the chosen take as up to date.',
    )
    await click(button('Accept'))
    expect(calls[0]).toMatchObject({ url: '/api/effects/chest-open/accept', method: 'POST' })
  })

  it('has no Accept when the length changed, alone or with the description', () => {
    for (const changed of [['length'], ['description', 'length']] as const) {
      const { text, buttons } = render(
        chosenRow({ status: 'changed', changed: [...changed] }),
        data,
      )
      expect(text()).toContain('A changed length needs a new take.')
      expect(buttons('Accept')).toHaveLength(0)
      cleanups.splice(0).forEach((c) => c())
    }
  })

  it('names length and description together', () => {
    const { text } = render(
      chosenRow({ status: 'changed', changed: ['description', 'length'] }),
      data,
    )
    expect(text()).toContain('Changed since its take was chosen: description and length.')
  })

  it('has no box when nothing changed', () => {
    const { container } = render(chosenRow(), data)
    expect(container.querySelector('.warnbox')).toBeNull()
  })
})

describe('takes being made', () => {
  const making = [
    { n: 4, state: 'making' as const, elapsed: 0.2, expected: 2.5, model: MODEL },
    { n: 5, state: 'waiting' as const, elapsed: 0, expected: 2.5, model: MODEL },
  ]

  it('shows a dashed card per take coming and Stop; the menu and button wait', async () => {
    const { container, text, button, click, calls } = render(
      chosenRow(),
      view({ takes: [take(2, { chosen: true })], making }),
    )
    const cards = [...container.querySelectorAll('.take-making')]
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringContaining('Take 4making · about 2 s left'),
      expect.stringContaining('Take 5waiting'),
    ])
    expect(container.querySelector<HTMLSelectElement>('select')!.disabled).toBe(true)
    expect(button('Make 4 more takes').disabled).toBe(true)
    expect(text()).toContain('Stop')
    await click(button('Stop'))
    expect(calls[0]).toMatchObject({ url: '/api/effects/chest-open/stop', method: 'POST' })
  })
})

describe('a take failed', () => {
  it('shows a red box with the reason, and Try again remakes that take', async () => {
    const { container, text, button, click, calls } = render(
      row({ status: 'not-chosen' }),
      view({ takes: [take(1)], failed: [{ n: 5, message: 'The effects generator stopped.' }] }),
    )
    const box = container.querySelector('.errbox')!
    expect(box.textContent).toContain('Take 5 could not be made.')
    expect(text()).toContain('The effects generator stopped. Your other takes are kept.')
    await click(button('Try again'))
    expect(JSON.parse(calls[0]!.body!)).toEqual({ retry: 5 })
  })

  it('leaves out "Your other takes are kept" when there are none', () => {
    const { text } = render(row(), view({ failed: [{ n: 1, message: 'It broke.' }] }))
    expect(text()).toContain('It broke.')
    expect(text()).not.toContain('Your other takes are kept')
  })
})

describe('the model is not ready', () => {
  const data = view({
    generator: { ok: false, message: 'Stable Audio 3 Small SFX is not on this computer.' },
    takes: [take(1), take(2, { chosen: true })],
  })

  it('says so with Open Setup, cannot make takes, and still chooses and drops', async () => {
    const { container, text, button, buttons, click, calls } = render(chosenRow(), data)
    expect(text()).toContain("Sound effects can't be made yet.")
    expect(text()).toContain(
      'Stable Audio 3 Small SFX is not on this computer. Setup says what is missing.',
    )
    expect(container.querySelector('a.btn')!.getAttribute('href')).toBe('#/setup')
    expect(button('Make 4 more takes').disabled).toBe(true)
    await click(buttons('Choose')[0]!)
    expect(calls[0]!.url).toBe('/api/effects/chest-open/choose')
  })
})

describe('the chosen clip is gone', () => {
  it('turns the block amber with Choose again, which chooses the take again', async () => {
    const data = view({ takes: [take(2, { chosen: true })] })
    const { container, text, button, click, calls } = render(
      chosenRow({ status: 'missing', current: { kind: 'take', take: 2, exists: false } }),
      data,
    )
    expect(container.querySelector('.track-in-game-warn')).not.toBeNull()
    expect(text()).toContain('clip missing')
    expect(text()).toContain(
      "The game's clip for this effect is not there. Choose again writes it again.",
    )
    expect(button('Un-choose')).toBeDefined()
    await click(button('Choose again'))
    expect(JSON.parse(calls[0]!.body!)).toEqual({ file: take(2).file })
  })
})

describe('the lock cannot be read', () => {
  const data = view({ takes: [take(1), take(2)], lockUnread: true })

  it('says which take plays is not known, and Choose and Drop wait', () => {
    const { container, text, buttons } = render(
      row({ status: 'unknown', current: { kind: 'unknown' } }),
      data,
    )
    expect(text()).toContain('The sound effects lock could not be read')
    expect(text()).toContain('Which take the game plays is not known.')
    expect(text()).toContain(
      'Choosing and dropping wait until the sound effects lock can be read. You can still listen and make more takes.',
    )
    expect(buttons('Choose').every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
    expect(buttons('Drop').every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
    expect(container.querySelectorAll('.play').length).toBe(2)
    expect(buttons('Make 4 more takes')[0]!.hasAttribute('disabled')).toBe(false)
  })
})

describe('an effect that loops', () => {
  const looping = (over: Partial<EffectRow> = {}) =>
    row({ id: 'rain', name: 'Rain', seconds: 10, loops: true, ...over })
  const loopTake = (n: number, over: Partial<EffectTakeView> = {}) =>
    take(n, { seconds: 10, loops: true, ...over })

  it('gives each looping take its seam mark, the game’s length and Hear the seam', () => {
    const { container, buttons } = render(
      looping({ status: 'not-chosen' }),
      view({ takes: [loopTake(1), loopTake(2)] }),
    )
    const cards = [...container.querySelectorAll('.takes .take')]
    expect(cards).toHaveLength(2)
    for (const card of cards) {
      expect(card.querySelector('.wave .seam')).not.toBeNull()
      expect(card.textContent).toContain('10.0 s')
      expect(card.textContent).toContain('Hear the seam')
    }
    expect(buttons('Hear the seam')).toHaveLength(2)
  })

  it('shows nothing extra on a take of an effect that plays once', () => {
    const { container, text } = render(row({ status: 'not-chosen' }), view({ takes: [take(1)] }))
    expect(container.querySelector('.seam')).toBeNull()
    expect(text()).not.toContain('Hear the seam')
    expect(text()).not.toContain('made to')
  })

  it('reads Stop while the seam plays, and Hear the seam again after', async () => {
    const { buttons, click } = render(
      looping({ status: 'not-chosen' }),
      view({ takes: [loopTake(1), loopTake(2)] }),
    )
    await click(buttons('Hear the seam')[0]!)
    expect(buttons('Stop')).toHaveLength(1)
    expect(buttons('Hear the seam')).toHaveLength(1)
    await click(buttons('Stop')[0]!)
    expect(buttons('Hear the seam')).toHaveLength(2)
  })

  it('has Hear the seam in the In the game block too', () => {
    const { container } = render(
      looping({ status: 'chosen', chosen: true, current: { kind: 'take', take: 2, exists: true } }),
      view({ takes: [loopTake(1), loopTake(2, { chosen: true })] }),
    )
    const block = container.querySelector('[aria-label="In the game"]')!
    expect(block.textContent).toContain('Hear the seam')
    expect(block.querySelector('.wave .seam')).not.toBeNull()
  })

  it('shades the quiet part and says where the loop goes quiet, on the card and in the block', () => {
    const { container } = render(
      looping({ status: 'chosen', chosen: true, current: { kind: 'take', take: 2, exists: true } }),
      view({ takes: [loopTake(1, { quietAt: 6.2 }), loopTake(2, { chosen: true, quietAt: 8.1 })] }),
    )
    const card = container.querySelector('.takes .take')!
    expect(card.textContent).toContain('Goes quiet at 6.2 s, so it loops with a gap.')
    expect(card.querySelector<HTMLElement>('.wave .quiet')!.style.width).toBe('38%')
    const block = container.querySelector('[aria-label="In the game"]')!
    expect(block.textContent).toContain('Goes quiet at 8.1 s, so it loops with a gap.')
    expect(block.querySelector<HTMLElement>('.wave .quiet')!.style.width).toBe('19%')
  })

  it('can still choose a take that goes quiet early', async () => {
    const { calls, click, buttons } = render(
      looping({ status: 'not-chosen' }),
      view({ takes: [loopTake(1, { quietAt: 6.2 })] }),
    )
    await click(buttons('Choose')[0]!)
    expect(calls[0]).toMatchObject({ url: '/api/effects/rain/choose', method: 'POST' })
  })

  it('compares with the same button, reading ■ Stop while it plays', async () => {
    const { buttons, click } = render(
      looping({ status: 'chosen', chosen: true, current: { kind: 'take', take: 2, exists: true } }),
      view({ takes: [loopTake(1), loopTake(2, { chosen: true })] }),
    )
    await click(buttons('▶ The chosen, then this')[0]!)
    expect(buttons('■ Stop')).toHaveLength(1)
  })
})

describe('the game changed how an effect plays', () => {
  const chosenTake = (over: Partial<EffectTakeView> = {}) =>
    take(2, { chosen: true, seconds: 7.4, ...over })
  const changedRow = (changed: EffectRow['changed'], loops: boolean) =>
    chosenRow({ id: 'wind', name: 'Wind', loops, status: 'changed', changed })

  it('once to looping: the amber box, no Accept; takes made to play once are marked, not choosable, with no seam', () => {
    const { container, text, buttons } = render(
      changedRow(['now loops'], true),
      view({
        takes: [
          take(1, { seconds: 6.8 }),
          chosenTake(),
          take(3),
          take(5, { loops: true, seconds: 10 }),
        ],
      }),
    )
    expect(text()).toContain('Changed since its take was chosen: now loops.')
    expect(text()).toContain(
      "The game plays the chosen take until you choose another. Make more takes that loop. A take made to play once can't loop without a jump.",
    )
    expect(buttons('Accept')).toHaveLength(0)
    const block = container.querySelector('[aria-label="In the game"]')!
    expect(block.textContent).toContain('made to play once')
    expect(block.textContent).not.toContain('Hear the seam')
    const cards = [...container.querySelectorAll('.takes .take')]
    expect(cards.map((c) => c.querySelector('b')!.textContent)).toEqual([
      'Take 1',
      'Take 3',
      'Take 5',
    ])
    expect(cards.map((c) => c.textContent!.includes('made to play once'))).toEqual([
      true,
      true,
      false,
    ])
    // Only the new looping take can be chosen or heard at its seam; the others can be played, compared and dropped.
    expect(cards.map((c) => c.textContent!.includes('Choose'))).toEqual([false, false, true])
    expect(cards.map((c) => c.textContent!.includes('Hear the seam'))).toEqual([false, false, true])
    expect(cards.every((c) => c.textContent!.includes('The chosen, then this'))).toBe(true)
    expect(cards.every((c) => c.textContent!.includes('Drop'))).toBe(true)
  })

  it('looping to once: marks takes made to loop, which keep Hear the seam but cannot be chosen', () => {
    const { container, text, buttons } = render(
      changedRow(['no longer loops'], false),
      view({
        takes: [
          chosenTake({ loops: true, seconds: 10 }),
          take(3),
          take(4, { loops: true, seconds: 10 }),
        ],
      }),
    )
    expect(text()).toContain('Changed since its take was chosen: no longer loops.')
    expect(text()).toContain(
      'A take made to loop runs to the full length instead of ending with its sound.',
    )
    expect(buttons('Accept')).toHaveLength(0)
    const cards = [...container.querySelectorAll('.takes .take')]
    expect(cards.map((c) => c.textContent!.includes('made to loop'))).toEqual([false, true])
    expect(cards.map((c) => c.textContent!.includes('Choose'))).toEqual([true, false])
    expect(cards[1]!.textContent).toContain('Hear the seam')
    expect(container.querySelector('[aria-label="In the game"]')!.textContent).toContain(
      'made to loop',
    )
  })

  it('words the box when the description or length changed too, and never offers Accept', () => {
    const { text, buttons } = render(
      changedRow(['description', 'now loops'], true),
      view({ takes: [chosenTake()] }),
    )
    expect(text()).toContain('Changed since its take was chosen: description, and now loops.')
    expect(buttons('Accept')).toHaveLength(0)
  })

  it('clears the box once a take of the new kind is chosen', () => {
    const { text, container } = render(
      chosenRow({ id: 'wind', loops: true }),
      view({ takes: [take(5, { loops: true, seconds: 10, chosen: true })] }),
    )
    expect(text()).not.toContain('Changed since')
    expect(container.querySelector('[aria-label="In the game"]')!.textContent).not.toContain(
      'made to',
    )
  })
})
