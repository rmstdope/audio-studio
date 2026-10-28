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
  gameFile: null,
}

const everyModel = (missing: string[] = []) =>
  (['balanced', 'quick', 'quickest', 'careful', 'short', 'shortest', 'eleven'] as const).map(
    (id) => ({
      id,
      installed: !missing.includes(id),
    }),
  )

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
      chosen: false,
      model: 'Balanced · XL turbo · 4B',
    },
  ],
  making: [],
  failed: [],
  lockUnread: false,
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

function render(data: MusicTakesView, row: TrackRow = track) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(['music-takes', 'hall'], data)
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
  const menu = () =>
    container.querySelector<HTMLSelectElement>('select[aria-label="Model for new takes"]')!
  const button = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === name,
    )!
  const count = () =>
    container.querySelector<HTMLSelectElement>('select[aria-label="Number of new takes"]')!
  return { container, menu, count, button }
}

describe('the Takes panel while the music lock cannot be read', () => {
  const why =
    'Choosing, dropping and moving wait until the music lock can be read. You can still listen and make more takes.'

  it('says why above the cards and greys out Choose and Drop, leaving Make 2 more takes alone', () => {
    const page = render(view({ lockUnread: true }))
    expect(page.container.textContent).toContain(why)
    expect(page.button('Choose').disabled).toBe(true)
    expect(page.button('Drop').disabled).toBe(true)
    expect(page.button('Make 2 more takes').disabled).toBe(false)
  })

  it('says why as soon as the first take is being made', () => {
    const making = [
      {
        n: 1,
        state: 'making' as const,
        elapsed: 5,
        model: 'Quick · XL turbo · 1.7B',
        expected: 75,
        paid: false,
      },
    ]
    const page = render(view({ lockUnread: true, takes: [], making }))
    expect(page.container.textContent).toContain(why)
  })

  it('says nothing on an empty panel, nor when the lock is readable', () => {
    expect(render(view({ lockUnread: true, takes: [] })).container.textContent).not.toContain(why)
    const ok = render(view({ lockUnread: false }))
    expect(ok.container.textContent).not.toContain(why)
    expect(ok.button('Choose').disabled).toBe(false)
  })
})

describe('the model menu on a track’s Takes panel', () => {
  it('sits just before Make 2 more takes, starting on the project’s model', () => {
    const page = render(view())
    const menu = page.menu()
    expect(menu.value).toBe('balanced')
    expect(menu.nextElementSibling).toBe(page.count())
    expect(page.count().nextElementSibling).toBe(page.button('Make 2 more takes'))
    expect([...menu.options].map((o) => o.textContent)).toEqual([
      'Balanced · XL turbo · 4B — about 3 min a take',
      'Quick · XL turbo · 1.7B — about 1¼ min a take',
      'Quickest · Turbo · 1.7B — about 1 min a take',
      'Careful · XL sft · 4B — about 7 min a take',
      'Short · Stable Audio Open 1.0 — makes loops up to 27 s · this one is 0:30',
      'Shortest · Stable Audio Open Small — makes no loops · this one is 0:30',
      'Eleven Music · ElevenLabs, in the cloud — about 1 min and $0.13 a take',
    ])
  })

  it('keeps the menu and Make 2 more takes in one group apart from the heading, so they wrap together', () => {
    const page = render(view())
    const group = page.menu().parentElement!
    expect(group.className).toBe('takes-controls')
    expect(group).toBe(page.button('Make 2 more takes').parentElement!)
    const heading = page.container.querySelector('h2')!
    expect(group.contains(heading)).toBe(false)
    expect(group.parentElement).toBe(heading.parentElement)
  })

  it('asks for takes with the model picked, and starts nothing by picking', async () => {
    const page = render(view())
    act(() => {
      page.menu().value = 'quick'
      page.menu().dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(posted).toEqual([])
    await click(page.button('Make 2 more takes'))
    expect(posted).toEqual([{ count: 2, model: 'quick' }])
  })

  it('is beside Make 2 takes when there are none, and the time follows the pick', async () => {
    const page = render(view({ takes: [] }))
    expect(page.menu().nextElementSibling).toBe(page.count())
    expect(page.count().nextElementSibling).toBe(page.button('Make 2 takes'))
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
    expect(page.button('Make 2 more takes').disabled).toBe(true)
    act(() => {
      page.menu().value = 'quick'
      page.menu().dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(page.button('Make 2 more takes').disabled).toBe(false)
    expect(page.container.textContent).not.toContain("Careful isn't on this computer")
  })

  it('is locked while takes are made, and every card names its model', () => {
    const page = render(
      view({
        making: [
          {
            n: 2,
            state: 'making',
            elapsed: 30,
            model: 'Quick · XL turbo · 1.7B',
            expected: 75,
            paid: false,
          },
          {
            n: 3,
            state: 'waiting',
            elapsed: 0,
            model: 'Quick · XL turbo · 1.7B',
            expected: 75,
            paid: false,
          },
        ],
      }),
    )
    expect(page.menu().disabled).toBe(true)
    expect(page.button('Make 2 more takes').disabled).toBe(true)
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
    expect(page.button('Make 2 more takes').disabled).toBe(true)
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
      view({
        failed: [
          { n: 2, message: 'out of memory', model: 'Careful · XL sft · 4B', modelId: 'careful' },
        ],
      }),
    )
    await click(page.button('Try again'))
    expect(posted).toEqual([{ retry: 2 }])
  })
})

describe('the Stable Audio models in a track’s menu', () => {
  const stinger = { ...track, seconds: 6 }
  const shortLoop = { ...track, seconds: 20 }
  const stingerView = (over: Partial<MusicTakesView> = {}) => view({ kind: 'stinger', ...over })

  it('is three groups under headings', () => {
    const page = render(view())
    expect([...page.menu().querySelectorAll('optgroup')].map((g) => g.label)).toEqual([
      'ACE-Step · any length',
      'Stable Audio · short music only',
      'ElevenLabs · in the cloud, paid',
    ])
  })

  it('greys a model that cannot make a long loop, saying why, and can pick the rest', () => {
    const page = render(view())
    const options = [...page.menu().options]
    expect(options.map((o) => o.disabled)).toEqual([false, false, false, false, true, true, false])
  })

  it('lets a short loop be made by Short, but not Shortest', () => {
    const page = render(view(), shortLoop)
    const options = [...page.menu().options]
    expect(options.find((o) => o.value === 'short')!.disabled).toBe(false)
    expect(options.find((o) => o.value === 'short')!.textContent).toBe(
      'Short · Stable Audio Open 1.0 — about 40 s a take',
    )
    expect(options.find((o) => o.value === 'shortest')!.disabled).toBe(true)
  })

  it('lets every model make a stinger, and times them', () => {
    const page = render(stingerView(), stinger)
    const options = [...page.menu().options]
    expect(options.every((o) => !o.disabled)).toBe(true)
    expect(options[5]!.textContent).toBe('Shortest · Stable Audio Open Small — about 10 s a take')
  })

  it('shows the length reason, not “not on this computer”, for a missing model too short', () => {
    const page = render(view({ models: everyModel(['short']) }))
    const short = [...page.menu().options].find((o) => o.value === 'short')!
    expect(short.textContent).toBe(
      'Short · Stable Audio Open 1.0 — makes loops up to 27 s · this one is 0:30',
    )
  })

  it('starts on Setup’s model when it cannot make the track, warns, and disables making', () => {
    const page = render(view({ defaultModel: 'short' }))
    expect(page.menu().value).toBe('short')
    expect(page.container.querySelector('.takes-missing')!.textContent).toBe(
      'Short makes loops up to 27 s, and this one is 0:30. Pick another model for these takes.',
    )
    expect(page.button('Make 2 more takes').disabled).toBe(true)
    act(() => {
      page.menu().value = 'quick'
      page.menu().dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(page.container.querySelector('.takes-missing')).toBeNull()
    expect(page.button('Make 2 more takes').disabled).toBe(false)
  })

  it('disables Make 2 takes the same way when there are no takes', () => {
    const page = render(view({ takes: [], defaultModel: 'shortest' }))
    expect(page.button('Make 2 takes').disabled).toBe(true)
    expect(page.container.querySelector('.takes-missing')!.textContent).toContain(
      'Shortest makes no loops, and this one is 0:30.',
    )
  })

  it('follows a length changed on the page: the pick stays and the line appears', () => {
    const page = render(view({ defaultModel: 'short' }), shortLoop)
    expect(page.button('Make 2 more takes').disabled).toBe(false)
    expect(page.container.querySelector('.takes-missing')).toBeNull()
  })

  it('says a Stable Audio model is not on this computer, in the agreed words, and does not allow it', () => {
    const page = render(
      stingerView({ defaultModel: 'short', models: everyModel(['short']) }),
      stinger,
    )
    expect(page.container.querySelector('.takes-missing')!.textContent).toBe(
      "Short isn't on this computer. Pick another model for these takes, or see Setup for how to download it.",
    )
    expect(page.button('Make 2 more takes').disabled).toBe(true)
  })
})

describe('the closed model menu’s short label', () => {
  const labels = (menu: HTMLSelectElement) => [...menu.options].map((o) => o.getAttribute('label'))
  const fire = (menu: HTMLSelectElement, event: Event) => act(() => void menu.dispatchEvent(event))

  it('labels only the chosen entry, and leaves every entry’s text whole', () => {
    const menu = render(view()).menu()
    expect(labels(menu)).toEqual([
      'Balanced — about 3 min a take',
      null,
      null,
      null,
      null,
      null,
      null,
    ])
    expect(menu.options[0]!.textContent).toBe('Balanced · XL turbo · 4B — about 3 min a take')
  })

  it('follows the pick', () => {
    const menu = render(view()).menu()
    act(() => {
      menu.value = 'quick'
      menu.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(labels(menu)[0]).toBeNull()
    expect(labels(menu)[1]).toBe('Quick — about 1¼ min a take')
  })

  it('says why in place of the time for a missing or too short model', () => {
    const missing = render(view({ defaultModel: 'careful', models: everyModel(['careful']) }))
    expect(labels(missing.menu())[3]).toBe('Careful — not on this computer')
    const short = render(view({ defaultModel: 'short' })).menu()
    expect(labels(short)[4]).toBe('Short — makes loops up to 27 s')
  })

  it('shows the whole list while the menu is open, and the short label again once it is not', () => {
    const menu = render(view()).menu()
    fire(menu, new MouseEvent('mousedown', { bubbles: true }))
    expect(labels(menu).every((l) => l === null)).toBe(true)
    fire(menu, new FocusEvent('focusout', { bubbles: true }))
    expect(labels(menu)[0]).toBe('Balanced — about 3 min a take')
    fire(menu, new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(labels(menu)[0]).toBeNull()
    fire(menu, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(labels(menu)[0]).toBe('Balanced — about 3 min a take')
    for (const key of ['Enter', 'F4', 'ArrowDown', 'ArrowUp']) {
      fire(menu, new KeyboardEvent('keydown', { key, bubbles: true }))
      expect(labels(menu)[0]).toBeNull()
      fire(menu, new FocusEvent('focusout', { bubbles: true }))
    }
    fire(menu, new KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true }))
    expect(labels(menu)[0]).toBe('Balanced — about 3 min a take')
    fire(menu, new MouseEvent('mousedown', { bubbles: true }))
    act(() => {
      menu.value = 'quick'
      menu.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(labels(menu)[1]).toBe('Quick — about 1¼ min a take')
  })

  it('keeps the short label while takes are being made', () => {
    const making = [
      { n: 1, state: 'making' as const, elapsed: 5, model: 'Balanced', expected: 75, paid: false },
    ]
    const menu = render(view({ making })).menu()
    expect(menu.disabled).toBe(true)
    expect(labels(menu)[0]).toBe('Balanced — about 3 min a take')
  })
})

describe('the banner when no music can be made', () => {
  it('says why, in the generator’s own words, and sends to Setup', () => {
    const page = render(
      view({
        generator: { ok: false, message: 'There is no ElevenLabs key.' },
        models: everyModel([
          'balanced',
          'quick',
          'quickest',
          'careful',
          'short',
          'shortest',
          'eleven',
        ]),
      }),
    )
    const banner = page.container.querySelector('.errbox')!
    expect(banner.querySelector('strong')!.textContent).toBe("Music can't be made yet.")
    expect(banner.querySelector('.muted')!.textContent).toBe(
      'There is no ElevenLabs key. Setup says what is missing.',
    )
    expect(banner.querySelector('a')!.textContent).toBe('Open Setup')
  })
})

/** Picks an entry of a menu, as a person does. */
function pick(menu: HTMLSelectElement, value: string) {
  act(() => {
    menu.value = value
    menu.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('the count menu on a track’s Takes panel', () => {
  const entries = (menu: HTMLSelectElement) => [...menu.options].map((o) => o.textContent)

  it('lists 1 take to 6 takes, starting at 2, with no price on a free model', () => {
    const page = render(view())
    expect(entries(page.count())).toEqual([
      '1 take',
      '2 takes',
      '3 takes',
      '4 takes',
      '5 takes',
      '6 takes',
    ])
    expect(page.count().value).toBe('2')
  })

  it('shows every total on a paid model, and only the count when closed', () => {
    const page = render(view({ defaultModel: 'eleven' }))
    expect(entries(page.count())).toEqual([
      '1 take · $0.13',
      '2 takes · $0.26',
      '3 takes · $0.39',
      '4 takes · $0.52',
      '5 takes · $0.65',
      '6 takes · $0.78',
    ])
    // Closed, every entry reads as its bare count so the menu is only as wide as '6 takes';
    // the list, once open, shows every total.
    const labels = () => [...page.count().options].map((o) => o.getAttribute('label'))
    expect(labels()).toEqual(['1 take', '2 takes', '3 takes', '4 takes', '5 takes', '6 takes'])
    act(() => {
      page.count().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(labels().every((l) => l === null)).toBe(true)
  })

  it('names the count on the button, and the total on a paid model, later or first batch', () => {
    const later = render(view({ defaultModel: 'eleven' }))
    pick(later.count(), '3')
    expect(later.button('Make 3 more takes · $0.39')).toBeDefined()
    pick(later.count(), '1')
    expect(later.button('Make 1 more take · $0.13')).toBeDefined()
    const first = render(view({ takes: [] }))
    pick(first.count(), '3')
    expect(first.button('Make 3 takes')).toBeDefined()
    pick(first.count(), '1')
    expect(first.button('Make 1 take')).toBeDefined()
  })

  it('asks for exactly that many takes, later or first batch, then goes back to 2', async () => {
    const later = render(view())
    pick(later.count(), '5')
    await click(later.button('Make 5 more takes'))
    expect(posted).toEqual([{ count: 5, model: 'balanced' }])
    expect(later.count().value).toBe('2')
    posted.length = 0
    const first = render(view({ takes: [] }))
    pick(first.count(), '6')
    await click(first.button('Make 6 takes'))
    expect(posted).toEqual([{ count: 6, model: 'balanced' }])
    expect(first.count().value).toBe('2')
  })

  it('is greyed from the press until the answer, so no pick can outlive the reset', async () => {
    let answer: (response: Response) => void = () => {}
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => (answer = resolve))) as unknown as typeof fetch
    const page = render(view())
    await act(async () => {
      page.button('Make 2 more takes').click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(page.count().disabled).toBe(true)
    await act(async () => answer(new Response(JSON.stringify({ ok: true }))))
  })

  it('keeps the count when the model changes, and the prices follow', () => {
    const page = render(view())
    pick(page.count(), '4')
    pick(page.menu(), 'eleven')
    expect(page.count().value).toBe('4')
    expect(page.button('Make 4 more takes · $0.52')).toBeDefined()
  })

  it('starts at 2 again on a fresh page', () => {
    const first = render(view())
    pick(first.count(), '6')
    expect(render(view()).count().value).toBe('2')
  })

  it('is greyed while takes are being made, and usable when the model cannot make the track', () => {
    const making = [
      { n: 2, state: 'making' as const, elapsed: 5, model: 'Balanced', expected: 75, paid: false },
    ]
    expect(render(view({ making })).count().disabled).toBe(true)
    const short = render(view({ defaultModel: 'short' }))
    expect(short.button('Make 2 more takes').disabled).toBe(true)
    expect(short.count().disabled).toBe(false)
  })

  it('has a name for a screen reader, and leaves Try again as one take', () => {
    const page = render(
      view({ failed: [{ n: 2, message: 'x', model: 'm', modelId: 'balanced' as const }] }),
    )
    expect(page.count().getAttribute('aria-label')).toBe('Number of new takes')
    expect(
      [...page.container.querySelectorAll('.errbox button')].map((b) => b.textContent),
    ).toEqual(['Try again'])
  })

  it('says to make more takes to hear a changed brief', () => {
    const page = render(view(), { ...track, status: 'changed', changed: ['brief'] } as TrackRow)
    expect(page.container.textContent).toContain(
      'The game plays the chosen take until you choose another. Make more takes to hear the new brief.',
    )
  })
})

describe('what Eleven Music takes cost, on the panel', () => {
  it('puts the price of the two takes on Make 2 more takes and Make 2 takes, and none on a free model', () => {
    const paid = render(view({ defaultModel: 'eleven' }))
    expect(paid.button('Make 2 more takes · $0.26')).toBeDefined()
    const empty = render(view({ defaultModel: 'eleven', takes: [] }))
    expect(empty.button('Make 2 takes · $0.26')).toBeDefined()
    expect(render(view()).button('Make 2 more takes')).toBeDefined()
  })

  it('warns on Stop that a take stopped in the cloud may still be billed, only while one is made', () => {
    const making = (paid: boolean, state: 'making' | 'waiting' = 'making') =>
      render(
        view({
          making: [{ n: 2, state, elapsed: 3, model: 'Eleven Music', expected: 60, paid }],
        }),
      ).button('Stop')
    expect(making(true).title).toBe(
      'ElevenLabs may still bill a take that is stopped while it is being made.',
    )
    expect(making(false).title).toBe('')
    expect(making(true, 'waiting').title).toBe('')
  })

  it('puts the price of the take on Try again when it failed on a paid model', () => {
    const failed = (modelId: 'eleven' | 'careful') =>
      render(view({ failed: [{ n: 2, message: 'timed out', model: 'a model', modelId }] }))
        .container
    const tryAgain = (c: HTMLElement) =>
      [...c.querySelectorAll('.errbox button')].map((b) => b.textContent)
    expect(tryAgain(failed('eleven'))).toEqual(['Try again · $0.13'])
    expect(tryAgain(failed('careful'))).toEqual(['Try again'])
  })

  it('prices two takes as twice the price of one, as the menu shows it', () => {
    const page = render(view({ defaultModel: 'eleven' }))
    expect(page.button('Make 2 more takes · $0.26')).toBeDefined()
  })
})
