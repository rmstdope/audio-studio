import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { TrackRow } from '../../../core/music'
import type { MusicTakesView } from '../../../core/musicTake'

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
  id: 'hall',
  title: 'Hall',
  plays: null,
  brief: 'A brief',
  seconds: 30,
  bpm: null,
  key: null,
  game: { brief: 'A brief', seconds: 30, bpm: null, key: null },
  status: 'chosen',
  changed: [],
  chosenAt: '2026-10-01T10:00:00.000Z',
  current: { kind: 'take', take: 1, exists: true },
}

const everyModel = (missing: string[] = []) =>
  (['balanced', 'quick', 'quickest', 'careful'] as const).map((id) => ({
    id,
    installed: !missing.includes(id),
  }))

const view = (over: Partial<MusicTakesView> = {}): MusicTakesView => ({
  ok: true,
  kind: 'loop',
  generator: { ok: true },
  defaultModel: 'balanced',
  models: everyModel(),
  takes: [
    {
      n: 1,
      file: 'aaaaaaaaaaaaaaaa.1.wav',
      seconds: 30,
      seed: 1,
      peaks: [0.5],
      earlier: false,
      chosen: true,
      model: 'Balanced · XL turbo · 4B',
    },
  ],
  making: [],
  failed: [],
  ...over,
})

/** Clicks, and lets the request and the page's reaction to it settle inside `act`. */
async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const posted: unknown[] = []
beforeEach(() => {
  posted.length = 0
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'POST') posted.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ ok: true }))
  }) as typeof fetch
})

function render(data: MusicTakesView) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(['music-takes', 'hall'], data)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  act(() =>
    root.render(
      createElement(QueryClientProvider, { client }, createElement(TakesPanel, { track })),
    ),
  )
  const menu = () =>
    container.querySelector<HTMLSelectElement>('select[aria-label="Model for new takes"]')!
  const button = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === name,
    )!
  return { container, menu, button }
}

describe('the model menu on a track’s Takes panel', () => {
  it('sits just before More takes, starting on the project’s model', () => {
    const page = render(view())
    const menu = page.menu()
    expect(menu.value).toBe('balanced')
    expect(menu.nextElementSibling).toBe(page.button('More takes'))
    expect([...menu.options].map((o) => o.textContent)).toEqual([
      'Balanced · XL turbo · 4B — about 3 min a take',
      'Quick · XL turbo · 1.7B — about 1¼ min a take',
      'Quickest · Turbo · 1.7B — about 1 min a take',
      'Careful · XL sft · 4B — about 7 min a take',
    ])
  })

  it('asks for takes with the model picked, and starts nothing by picking', async () => {
    const page = render(view())
    act(() => {
      page.menu().value = 'quick'
      page.menu().dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(posted).toEqual([])
    await click(page.button('More takes'))
    expect(posted).toEqual([{ count: 2, model: 'quick' }])
  })

  it('is beside Make 2 takes when there are none, and the time follows the pick', async () => {
    const page = render(view({ takes: [] }))
    expect(page.menu().nextElementSibling).toBe(page.button('Make 2 takes'))
    expect(page.container.textContent).toContain(
      'Each take is new music made from the brief, about 3 minutes each.',
    )
    act(() => {
      page.menu().value = 'careful'
      page.menu().dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(page.container.textContent).toContain('about 7 minutes each.')
    await click(page.button('Make 2 takes'))
    expect(posted).toEqual([{ count: 2, model: 'careful' }])
  })

  it('marks a model this computer lacks, and cannot pick it', () => {
    const page = render(view({ models: everyModel(['careful']) }))
    const careful = [...page.menu().options].find((o) => o.value === 'careful')!
    expect(careful.textContent).toBe(
      'Careful · XL sft · 4B — about 7 min a take — not on this computer',
    )
    expect(careful.disabled).toBe(true)
  })

  it('starts on a missing default, says so, and makes nothing until another is picked', () => {
    const page = render(view({ defaultModel: 'careful', models: everyModel(['careful']) }))
    expect(page.menu().value).toBe('careful')
    expect(page.container.textContent).toContain(
      "Careful isn't on this computer. Pick another model for these takes, or see Setup for how to download it.",
    )
    expect(page.button('More takes').disabled).toBe(true)
    act(() => {
      page.menu().value = 'quick'
      page.menu().dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(page.button('More takes').disabled).toBe(false)
    expect(page.container.textContent).not.toContain("Careful isn't on this computer")
  })

  it('is locked while takes are made, and every card names its model', () => {
    const page = render(
      view({
        making: [
          { n: 2, state: 'making', elapsed: 30, model: 'Quick · XL turbo · 1.7B', expected: 75 },
          { n: 3, state: 'waiting', elapsed: 0, model: 'Quick · XL turbo · 1.7B', expected: 75 },
        ],
      }),
    )
    expect(page.menu().disabled).toBe(true)
    expect(page.button('More takes').disabled).toBe(true)
    const cards = [...page.container.querySelectorAll('.take')].map((c) => c.textContent!)
    expect(cards).toHaveLength(3)
    expect(cards[0]).toContain('Balanced · XL turbo · 4B')
    expect(cards[1]).toContain('Quick · XL turbo · 1.7B')
    expect(cards[2]).toContain('Quick · XL turbo · 1.7B')
    expect(cards[1]).toContain('making · about 1 min left')
  })

  it('stays disabled for making when the generator is not installed at all, but is shown', () => {
    const page = render(view({ generator: { ok: false, message: 'none' } }))
    expect(page.menu()).not.toBeNull()
    expect(page.button('More takes').disabled).toBe(true)
    expect(page.container.textContent).not.toContain("isn't on this computer. Pick another")
  })

  it('says a missing default beneath the menu in the empty state too', () => {
    const page = render(
      view({ takes: [], defaultModel: 'careful', models: everyModel(['careful']) }),
    )
    const line = page.container.querySelector('.takes-missing')!
    expect(
      page.menu().compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(page.button('Make 2 takes').disabled).toBe(true)
  })

  it('tries a failed take again without a model, so it keeps its own', async () => {
    const page = render(
      view({ failed: [{ n: 2, message: 'out of memory', model: 'Careful · XL sft · 4B' }] }),
    )
    await click(page.button('Try again'))
    expect(posted).toEqual([{ retry: 2 }])
  })
})
