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
