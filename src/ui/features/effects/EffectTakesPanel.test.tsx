import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { EffectRow } from '../../../core/effects'
import type { EffectTakesView, EffectTakeView } from '../../../core/effectTakes'
import { installFakeWebAudio, started } from '../../../../test/fakeWebAudio'

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
  answer: (call: Call) => Response | Promise<Response> = () => Response.json({ ok: true }),
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
  const draw = (shown: EffectRow) =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EffectTakesPanel, { row: shown }),
      ),
    )
  act(() => draw(effect))
  /** Shows the page as it reads after the studio changed: a new row and new takes. */
  const rerender = (shown: EffectRow, shownData: EffectTakesView) =>
    act(() => {
      client.setQueryData(['effect-takes', shown.id], shownData)
      draw(shown)
    })
  const text = () => container.textContent!.replace(/\s+/g, ' ')
  const buttons = (label: string) =>
    [...container.querySelectorAll('button')].filter((b) => b.textContent!.trim() === label)
  const button = (label: string) => buttons(label)[0]!
  const click = async (b: Element) => {
    await act(async () => (b as HTMLElement).click())
    await act(async () => void (await new Promise((r) => setTimeout(r, 5))))
  }
  return { container, calls, text, button, buttons, click, rerender }
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
    expect(JSON.parse(calls[0]!.body!)).toEqual({ count: 2, model: 'small-sfx' })
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
    const { container, calls, click, button } = render(chosenRow(), data)
    await click(button('Un-choose'))
    await click(container.querySelector<HTMLButtonElement>('[role="alertdialog"] .btn-primary')!)
    expect(calls[0]).toMatchObject({ url: '/api/effects/chest-open/unchoose', method: 'POST' })
  })

  it('names the take and the reason when it fails, and leaves the block', async () => {
    const refuse = () =>
      Response.json(
        { ok: false, message: 'The sound effects lock could not be read.' },
        { status: 409 },
      )
    const { container, text, click, button } = render(chosenRow(), data, refuse)
    await click(button('Un-choose'))
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
    canMake: false,
    models: [
      { id: 'small-sfx', download: 'absent', failed: false },
      { id: 'open-1', download: 'absent', failed: false },
    ],
    takes: [take(1), take(2, { chosen: true })],
  })

  it('says so with Open Setup, cannot make takes, and still chooses and drops', async () => {
    const { container, text, button, buttons, click, calls } = render(chosenRow(), data)
    expect(text()).toContain("Sound effects can't be made yet.")
    expect(text()).toContain(
      'Neither sound-effects model can run on this computer. Setup says what is missing.',
    )
    expect(container.querySelector('a.btn')!.getAttribute('href')).toBe('#/setup')
    expect(button('Make 4 more takes').disabled).toBe(true)
    for (const label of ['Model for new takes', 'Number of new takes']) {
      expect(
        container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!.disabled,
      ).toBe(true)
    }
    expect(text()).toContain('Open Setup')
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
      'Choosing, dropping and fading wait until the sound effects lock can be read. You can still listen and make more takes.',
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
      expect(card.textContent).toContain('10 s')
      expect(card.textContent).not.toContain('10.0')
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

  it('plays a looping take round, and a take of a one-shot once', async () => {
    cleanups.push(installFakeWebAudio())
    const loops = render(looping({ status: 'not-chosen' }), view({ takes: [loopTake(1)] }))
    await loops.click(loops.container.querySelector('.takes .play')!)
    expect(started).toEqual([{ loop: true }])
    cleanups.splice(0).forEach((c) => c())
    cleanups.push(installFakeWebAudio())
    const once = render(row({ status: 'not-chosen' }), view({ takes: [take(1)] }))
    await once.click(once.container.querySelector('.takes .play')!)
    expect(started).toEqual([])
  })

  it('compares with the same button, the chosen loop round first, reading ■ Stop while it plays', async () => {
    cleanups.push(installFakeWebAudio())
    const { buttons, click } = render(
      looping({ status: 'chosen', chosen: true, current: { kind: 'take', take: 2, exists: true } }),
      view({ takes: [loopTake(1), loopTake(2, { chosen: true })] }),
    )
    await click(buttons('▶ The chosen, then this')[0]!)
    expect(started).toEqual([{ loop: true }])
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

describe('the model for new takes', () => {
  const modelMenu = (container: HTMLElement) =>
    container.querySelector<HTMLSelectElement>('select[aria-label="Model for new takes"]')!
  const states = (
    small: Partial<EffectTakesView['models'][number]>,
    open: Partial<EffectTakesView['models'][number]> = {},
  ): EffectTakesView['models'] => [
    { id: 'small-sfx', download: 'whole', failed: false, ...small },
    { id: 'open-1', download: 'whole', failed: false, ...open },
  ]

  it('is a menu before the count menu, with both full names and times, starting on Setup’s model', () => {
    const { container } = render(row(), view({ takes: [take(1)] }))
    const selects = [...container.querySelectorAll('.takes-controls select')].map((n) =>
      n.getAttribute('aria-label'),
    )
    expect(selects).toEqual(['Model for new takes', 'Number of new takes'])
    expect([...modelMenu(container).options].map((o) => o.textContent)).toEqual([
      'Stable Audio 3 Small SFX — about 2 s a take',
      'Stable Audio Open 1.0 — about 100 s a take',
    ])
    expect(modelMenu(container).value).toBe('small-sfx')
    const open = render(row(), view({ projectModel: 'open-1', takes: [take(1)] }))
    expect(modelMenu(open.container).value).toBe('open-1')
  })

  it('makes with the picked model, and the pick lasts only while the page is open', async () => {
    const page = render(row(), view({ takes: [take(1)] }))
    await act(async () => {
      modelMenu(page.container).value = 'open-1'
      modelMenu(page.container).dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.click(page.button('Make 4 more takes'))
    expect(JSON.parse(page.calls[0]!.body!)).toEqual({ count: 4, model: 'open-1' })
    const again = render(row(), view({ takes: [take(1)] }))
    expect(modelMenu(again.container).value).toBe('small-sfx')
  })

  it('starts on the other model, with a faint line saying why, when Setup’s is not on this computer', async () => {
    const page = render(row(), view({ takes: [take(1)], models: states({ download: 'absent' }) }))
    expect(modelMenu(page.container).value).toBe('open-1')
    expect(page.text()).toContain(
      "Stable Audio 3 Small SFX, the project's sound-effects model, isn't on this computer, so these takes use Stable Audio Open 1.0. Setup says how to download it.",
    )
    const [small, open] = [...modelMenu(page.container).options]
    expect(small!.textContent).toBe(
      'Stable Audio 3 Small SFX — about 2 s a take — not on this computer',
    )
    expect(small!.disabled).toBe(true)
    expect(open!.disabled).toBe(false)
    await page.click(page.button('Make 4 more takes'))
    expect(JSON.parse(page.calls[0]!.body!)).toEqual({ count: 4, model: 'open-1' })
  })

  it('says a partly downloaded or failed model is why, and keeps a failed one pickable', () => {
    const partial = render(row(), view({ models: states({ download: 'partial' }) }))
    expect(partial.text()).toContain(
      "the project's sound-effects model, is only partly downloaded, so these takes use Stable Audio Open 1.0. Setup says how to finish it.",
    )
    const failed = render(row(), view({ models: states({ failed: true }) }))
    expect(modelMenu(failed.container).value).toBe('open-1')
    expect(failed.text()).toContain(
      'failed on its last effect, so these takes use Stable Audio Open 1.0. Setup says what went wrong.',
    )
    const small = [...modelMenu(failed.container).options][0]!
    expect(small.textContent).toBe(
      'Stable Audio 3 Small SFX — about 2 s a take — last effect failed',
    )
    expect(small.disabled).toBe(false)
  })

  it('has no line when Setup’s model is the one used', () => {
    const { text } = render(row(), view({ takes: [take(1)] }))
    expect(text()).not.toContain('so these takes use')
  })

  it('waits while a batch is made', () => {
    const making = {
      n: 2,
      state: 'making' as const,
      elapsed: 0,
      expected: 2,
      model: MODEL,
    }
    const { container } = render(row(), view({ takes: [take(1)], making: [making] }))
    expect(modelMenu(container).disabled).toBe(true)
  })

  it('shows an Open 1.0 take waiting for the graphics chip, what uses it, and the takes behind it waiting', () => {
    const waiting = (n: number, chip?: { using: 'music' | null }) => ({
      n,
      state: 'waiting' as const,
      elapsed: 0,
      expected: 100,
      model: 'Stable Audio Open 1.0',
      ...(chip ? { chip } : {}),
    })
    const { container, text } = render(
      row(),
      view({ takes: [take(1)], making: [waiting(2, { using: 'music' }), waiting(3)] }),
    )
    const cards = [...container.querySelectorAll('.take-making')].map((c) =>
      c.textContent!.replace(/\s+/g, ' '),
    )
    expect(cards[0]).toContain('waiting for the graphics chip')
    expect(cards[0]).toContain('Music is being made first.')
    expect(cards[1]).toContain('waiting')
    expect(cards[1]).not.toContain('graphics chip')
    expect(text()).toContain('Stable Audio Open 1.0')
  })

  it('counts an Open 1.0 take down in minutes', () => {
    const making = {
      n: 2,
      state: 'making' as const,
      elapsed: 30,
      expected: 100,
      model: 'Stable Audio Open 1.0',
    }
    expect(render(row(), view({ making: [making] })).text()).toContain(
      'making · about 1 min 10 s left',
    )
  })

  it('remakes a failed take with Try again, which names no model so the take keeps its own', async () => {
    const page = render(row(), view({ takes: [take(1)], failed: [{ n: 5, message: 'It broke.' }] }))
    await page.click(page.button('Try again'))
    expect(JSON.parse(page.calls[0]!.body!)).toEqual({ retry: 5 })
  })
})

describe('Trim silence', () => {
  const cut = { start: 0.22, end: 0.14, seconds: 1.04 }
  const trimmable = (n: number, over: Partial<EffectTakeView> = {}) =>
    take(n, { trimmable: 'cut', ...over })
  const bottomRow = (card: Element) =>
    [...card.querySelectorAll('.take-row')].find((r) =>
      [...r.querySelectorAll('button')].some((b) => b.textContent === 'Drop'),
    )!
  const labels = (row: Element) => [...row.querySelectorAll('button')].map((b) => b.textContent)

  it('sits at the left of a card’s bottom row, with Drop and Choose at the right', () => {
    const { container } = render(row({ status: 'not-chosen' }), view({ takes: [trimmable(1)] }))
    const card = container.querySelector('.take')!
    expect(labels(bottomRow(card))).toEqual(['Trim silence', 'Fades…', 'Drop', 'Choose'])
    expect(bottomRow(card).querySelector('.grow')).not.toBeNull()
  })

  it('stays out of the listening row beside ▶ The chosen, then this', () => {
    const { container } = render(
      chosenRow(),
      view({ takes: [trimmable(1), take(2, { chosen: true })] }),
    )
    const card = container.querySelector('.takes .take')!
    const listening = [...card.querySelectorAll('.take-row')].find((r) =>
      [...r.querySelectorAll('button')].some((b) => b.textContent === '▶ The chosen, then this'),
    )!
    expect(labels(listening)).toEqual(['▶ The chosen, then this'])
  })

  it('is offered only on a take that can go into the game', () => {
    const { buttons } = render(
      row({ status: 'not-chosen' }),
      view({ takes: [take(1, { loops: true }), take(2)] }),
    )
    expect(buttons('Trim silence')).toHaveLength(0)
  })

  it('asks the studio, reads Trimming… and keeps focus on the button while it works', async () => {
    let finish = () => {}
    const { calls, buttons, click } = render(
      row({ status: 'not-chosen' }),
      view({ takes: [trimmable(1)] }),
      (call) =>
        call.url.endsWith('/trim')
          ? (new Promise(
              (resolve) => (finish = () => resolve(Response.json({ ok: true }))),
            ) as never)
          : Response.json({ ok: true }),
    )
    const button = buttons('Trim silence')[0]!
    button.focus()
    await click(button)
    expect(calls[0]).toMatchObject({ url: '/api/effects/chest-open/trim', method: 'POST' })
    expect(JSON.parse(calls[0]!.body!)).toEqual({ file: take(1).file, undo: false })
    expect(buttons('Trimming…')[0]).toBe(button)
    expect(document.activeElement).toBe(button)
    await act(async () => finish())
  })

  it('shows a trimmed card: tag, length, line, Undo trim, hatched ends', () => {
    const { container, text, buttons } = render(
      row({ status: 'not-chosen' }),
      view({ takes: [take(1, { trim: cut })] }),
    )
    expect(container.querySelector('.take-tag')?.textContent).toBe('trimmed')
    expect(text()).toContain('1.0 s')
    expect(text()).toContain('0.22 s cut from the start, 0.14 s from the end')
    expect(buttons('Undo trim')).toHaveLength(1)
    expect(buttons('Trim silence')).toHaveLength(0)
    expect([...container.querySelectorAll<HTMLElement>('.wave .cutzone')]).toHaveLength(2)
    expect(container.querySelectorAll('.wave i')).toHaveLength(3)
  })

  it('names only the end that lost something', () => {
    const { text } = render(
      row({ status: 'not-chosen' }),
      view({ takes: [take(1, { trim: { start: 0.31, end: 0, seconds: 1.09 } })] }),
    )
    expect(text()).toContain('0.31 s cut from the start')
    expect(text()).not.toContain('from the end')
  })

  it('undoes a trim', async () => {
    const { calls, buttons, click } = render(
      row({ status: 'not-chosen' }),
      view({ takes: [take(1, { trim: cut })] }),
    )
    await click(buttons('Undo trim')[0]!)
    expect(JSON.parse(calls[0]!.body!)).toEqual({ file: take(1).file, undo: true })
  })

  it('is greyed out with the reason when there is nothing to cut or no sound', () => {
    const { text, buttons } = render(
      row({ status: 'not-chosen' }),
      view({ takes: [take(1, { trimmable: 'nothing' }), take(2, { trimmable: 'silent' })] }),
    )
    expect(buttons('Trim silence').every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
    expect(text()).toContain('Starts and ends on its sound: nothing to cut.')
    expect(text()).toContain('Near-silent throughout: there is no sound to keep.')
  })

  it('waits, with no new line, when the lock cannot be read', () => {
    const { text, buttons } = render(
      row({ status: 'unknown', current: { kind: 'unknown' } }),
      view({ takes: [trimmable(1), take(2, { trim: cut })], lockUnread: true }),
    )
    expect(buttons('Trim silence')[0]!.disabled).toBe(true)
    expect(buttons('Undo trim')[0]!.disabled).toBe(true)
    expect(text()).toContain(
      'Choosing, dropping and fading wait until the sound effects lock can be read.',
    )
  })

  it('says why it failed, next to the button, and the take is as it was', async () => {
    const refuse = () =>
      Response.json(
        { ok: false, message: 'The take’s sound file could not be read.' },
        { status: 409 },
      )
    const { text, buttons, click } = render(
      row({ status: 'not-chosen' }),
      view({ takes: [trimmable(6)] }),
      refuse,
    )
    await click(buttons('Trim silence')[0]!)
    expect(text()).toContain(
      'Take 6 could not be trimmed: the take’s sound file could not be read. The take is as it was.',
    )
    expect(buttons('Trim silence')[0]!.disabled).toBe(false)
  })

  it('on the take in the game: the button at the left of the actions row, Un-choose at the right', () => {
    const { container, buttons } = render(
      chosenRow(),
      view({ takes: [take(1), trimmable(2, { chosen: true })] }),
    )
    const block = container.querySelector('[aria-label="In the game"]')!
    expect(labels(block.querySelector('.track-in-game-actions')!)).toEqual([
      'Trim silence',
      'Fades…',
      'Un-choose',
    ])
    expect(buttons('Trim silence')).toHaveLength(1)
  })

  it('on a trimmed take in the game: tag before chosen, Undo trim, failure names the game', async () => {
    const refuse = () =>
      Response.json(
        { ok: false, message: 'The game’s file could not be written.' },
        { status: 409 },
      )
    const { container, text, buttons, click } = render(
      chosenRow(),
      view({ takes: [take(2, { chosen: true, trim: cut })] }),
      refuse,
    )
    const head = container.querySelector('[aria-label="In the game"] .take-row')!
    expect(head.textContent).toMatch(/Take 2trimmedchosen/)
    await click(buttons('Undo trim')[0]!)
    expect(text()).toContain(
      'Take 2 could not be untrimmed: the game’s file could not be written. The game still plays it trimmed.',
    )
  })

  it('on the take in the game: claims nothing about the game when its files could not be put back', async () => {
    const stuck = () =>
      Response.json(
        {
          ok: false,
          message:
            'content-studio/cache/effect-boards/door-creak.json could not be written, and the game’s files could not be put back',
          gameChanged: true,
        },
        { status: 409 },
      )
    const said = (word: string) =>
      `Take 2 could not be ${word}: content-studio/cache/effect-boards/door-creak.json could not be written, and the game’s files could not be put back.`
    const trimming = render(chosenRow(), view({ takes: [trimmable(2, { chosen: true })] }), stuck)
    await trimming.click(trimming.buttons('Trim silence')[0]!)
    expect(trimming.text()).toContain(said('trimmed'))
    expect(trimming.text()).not.toContain('still plays')
    const undoing = render(
      chosenRow(),
      view({ takes: [take(2, { chosen: true, trim: cut })] }),
      stuck,
    )
    await undoing.click(undoing.buttons('Undo trim')[0]!)
    expect(undoing.text()).toContain(said('untrimmed'))
    expect(undoing.text()).not.toContain('still plays')
  })

  describe('a failed trim, then a later action on the take that works', () => {
    const fades = { in: 0.05, out: 0.1, shape: 'straight' as const }
    const untrimmed = 'Take 2 could not be untrimmed'
    /** Refuses every trim; everything else works. */
    const refuseTrim = (call: Call) =>
      call.url.endsWith('/trim')
        ? Response.json(
            { ok: false, message: 'The game’s file could not be written.' },
            { status: 409 },
          )
        : Response.json({ ok: true })

    it('in the game: removing the fades takes the red line away', async () => {
      const { text, buttons, button, click } = render(
        chosenRow(),
        view({ takes: [take(2, { chosen: true, trim: cut, fades })] }),
        refuseTrim,
      )
      await click(buttons('Undo trim')[0]!)
      expect(text()).toContain(untrimmed)
      await click(button('Fades…'))
      await click(button('Remove fades'))
      expect(text()).not.toContain(untrimmed)
    })

    it('on a card: removing the fades takes the red line away', async () => {
      const { text, buttons, button, click } = render(
        row({ status: 'not-chosen' }),
        view({ takes: [trimmable(6, { fades })] }),
        refuseTrim,
      )
      await click(buttons('Trim silence')[0]!)
      expect(text()).toContain('Take 6 could not be trimmed')
      await click(button('Fades…'))
      await click(button('Remove fades'))
      expect(text()).not.toContain('Take 6 could not be trimmed')
    })

    it('in the game: Choose again takes the red line away', async () => {
      const { text, buttons, button, click } = render(
        chosenRow({ current: { kind: 'take', take: 2, exists: false }, status: 'missing' }),
        view({ takes: [take(2, { chosen: true, trim: cut })] }),
        refuseTrim,
      )
      await click(buttons('Undo trim')[0]!)
      expect(text()).toContain(untrimmed)
      await click(button('Choose again'))
      expect(text()).not.toContain(untrimmed)
    })

    it('in the game: another take chosen is not blamed for the first one’s failure', async () => {
      const { text, buttons, click, rerender } = render(
        chosenRow(),
        view({ takes: [take(1), take(2, { chosen: true, trim: cut })] }),
        refuseTrim,
      )
      await click(buttons('Undo trim')[0]!)
      expect(text()).toContain(untrimmed)
      rerender(
        chosenRow({ current: { kind: 'take', take: 1, exists: true } }),
        view({ takes: [take(1, { chosen: true, trim: cut }), take(2, { trim: cut })] }),
      )
      expect(text()).not.toContain('could not be untrimmed')
    })

    it('in the game: chosen again from its card after another take, the red line does not come back', async () => {
      const { text, buttons, click, rerender } = render(
        chosenRow(),
        view({ takes: [take(1), take(2, { chosen: true, trim: cut })] }),
        refuseTrim,
      )
      await click(buttons('Undo trim')[0]!)
      rerender(
        chosenRow({ current: { kind: 'take', take: 1, exists: true } }),
        view({ takes: [take(1, { chosen: true }), take(2, { trim: cut })] }),
      )
      rerender(chosenRow(), view({ takes: [take(1), take(2, { chosen: true, trim: cut })] }))
      expect(text()).not.toContain(untrimmed)
    })

    it('on a card: saving changed fades takes the red line away', async () => {
      const { container, text, buttons, button, click } = render(
        row({ status: 'not-chosen' }),
        view({ takes: [trimmable(6)] }),
        refuseTrim,
      )
      await click(buttons('Trim silence')[0]!)
      expect(text()).toContain('Take 6 could not be trimmed')
      await click(button('Fades…'))
      const box = container.querySelector<HTMLInputElement>('.editor input[type="number"]')!
      await act(async () => {
        const set = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )!.set!
        set.call(box, '0.05')
        box.dispatchEvent(new window.Event('input', { bubbles: true }))
      })
      await click(button('Save fades'))
      expect(text()).not.toContain('Take 6 could not be trimmed')
    })

    it('a fade saved while a trim is still working leaves the trim working, and its failure shown', async () => {
      let refuse: (() => void) | null = null
      const answer = (call: Call) =>
        call.url.endsWith('/trim')
          ? new Promise<Response>((done) => {
              refuse = () => done(refuseTrim(call))
            })
          : Response.json({ ok: true })
      const { text, buttons, button, click } = render(
        chosenRow(),
        view({ takes: [take(2, { chosen: true, trim: cut, fades })] }),
        answer,
      )
      await click(buttons('Undo trim')[0]!)
      expect(buttons('Trimming…')).toHaveLength(1)
      await click(button('Fades…'))
      await click(button('Remove fades'))
      expect(buttons('Trimming…')).toHaveLength(1)
      await act(async () => refuse!())
      await act(async () => void (await new Promise((r) => setTimeout(r, 5))))
      expect(text()).toContain(untrimmed)
    })

    it('in the game: un-chosen, then chosen again, the red line does not come back', async () => {
      const { container, text, buttons, button, click, rerender } = render(
        chosenRow(),
        view({ takes: [take(2, { chosen: true, trim: cut })] }),
        refuseTrim,
      )
      await click(buttons('Undo trim')[0]!)
      await click(button('Un-choose'))
      await click(container.querySelector<HTMLButtonElement>('[role="alertdialog"] .btn-primary')!)
      rerender(row({ status: 'not-chosen' }), view({ takes: [take(2, { trim: cut })] }))
      rerender(chosenRow(), view({ takes: [take(2, { chosen: true, trim: cut })] }))
      expect(text()).not.toContain(untrimmed)
    })

    it('in the game: the red line sits under the buttons, above the line about Un-choose', async () => {
      const { container, buttons, click } = render(
        chosenRow(),
        view({ takes: [take(2, { chosen: true, trim: cut })] }),
        refuseTrim,
      )
      await click(buttons('Undo trim')[0]!)
      const actions = container.querySelector('.track-in-game-actions')!
      expect(actions.nextElementSibling!.textContent).toContain(untrimmed)
    })
  })

  it('on a take in the game whose clip is missing, still next to Choose again', () => {
    const { container } = render(
      chosenRow({ current: { kind: 'take', take: 2, exists: false }, status: 'missing' }),
      view({ takes: [trimmable(2, { chosen: true })] }),
    )
    const actions = container.querySelector('.track-in-game-actions')!
    expect(labels(actions)).toEqual(['Trim silence', 'Fades…', 'Un-choose', 'Choose again'])
  })

  it('plays only the part between the cuts, in Play and in the comparison', async () => {
    cleanups.push(installFakeWebAudio())
    // A one-clip Play goes through an audio element: note the elements, and read their source.
    const elements: { src: string }[] = []
    const Fake = globalThis.Audio
    globalThis.Audio = class extends Fake {
      constructor() {
        super()
        elements.push(this)
      }
    }
    const { calls, container, buttons, click } = render(
      chosenRow(),
      view({ takes: [take(1, { trim: cut }), take(2, { chosen: true, trim: cut })] }),
    )
    expect(container.querySelectorAll('.wave .cutzone').length).toBe(4)
    const sounds = () => [
      ...calls.filter((c) => c.url.includes('/takes/')).map((c) => c.url),
      ...elements
        .map((element) => element.src)
        .filter(Boolean)
        .map((url) => url.replace(/^https?:\/\/[^/]+/, '')),
    ]
    await click(container.querySelector('.takes .play')!)
    expect(sounds()).toEqual([`/api/effects/chest-open/takes/${take(1).file}?trimmed=1`])
    calls.length = 0
    elements.forEach((element) => (element.src = ''))
    await click(buttons('▶ The chosen, then this')[0]!)
    // The chosen take comes first; the one compared with it follows when it has ended.
    expect(sounds()).toEqual([`/api/effects/chest-open/takes/${take(2).file}?trimmed=1`])
    calls.length = 0
    elements.forEach((element) => (element.src = ''))
    await click(buttons('■ Stop')[0]!)
    await click(container.querySelector('[aria-label="In the game"] .play')!)
    expect(sounds()).toEqual([`/api/effects/chest-open/takes/${take(2).file}?trimmed=1`])
  })

  it('once the effect loops: no button on a play-once take, Undo trim kept on a trimmed one', () => {
    const { container, buttons } = render(
      chosenRow({ loops: true }),
      view({ takes: [take(1), take(2, { chosen: true, trim: cut })] }),
    )
    expect(buttons('Trim silence')).toHaveLength(0)
    expect(buttons('Undo trim')).toHaveLength(1)
    expect(container.querySelector('[aria-label="In the game"]')!.textContent).toContain(
      'Undo trim',
    )
  })
})
