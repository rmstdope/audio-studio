import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ImageRow, PatchRow } from '../../../core/images'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { GamePatchesPanel } = await import('./GamePatchesPanel')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
const realFetch = globalThis.fetch
afterEach(() => {
  cleanups.splice(0).forEach((c) => c())
  globalThis.fetch = realFetch
})
afterAll(() => GlobalRegistrator.unregister())

const patch = (id: string, over: Partial<PatchRow> = {}): PatchRow => ({
  id,
  title: `Title of ${id}`,
  description: `Game words of ${id}`,
  words: `Game words of ${id}`,
  changed: false,
  gameChanged: false,
  gameWas: null,
  chosenOn: [],
  chosenOnGone: false,
  chosenArea: null,
  ...over,
})

/** Renders the panel for an image with these patches; `answer` is what saving answers. */
async function render(
  patches: PatchRow[],
  answer: { status: number; body: unknown } = { status: 200, body: { ok: true } },
  view: Record<string, unknown> | null = {},
  shape: { width?: number; height?: number; chosenTake?: number | null } = {},
) {
  const sent: { method: string; path: string; body: unknown }[] = []
  globalThis.fetch = (async (path: string, init?: RequestInit) => {
    // The takes of the patches are PatchWorkbench.test's; here there is nothing to patch on.
    if (path.split('?')[0] === '/api/images/inn/patches') {
      // null: the patches never finish loading
      if (view === null) return new Promise<Response>(() => {})
      return Response.json({
        ok: true,
        take: null,
        pictureGone: false,
        remake: { earlier: {}, press: null, failedModels: [] },
        maker: { ok: true },
        models: { 'qwen-edit': 'whole', klein: 'whole' },
        patches: [],
        ...view,
      })
    }
    sent.push({
      method: init?.method ?? 'GET',
      path,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
    return Response.json(answer.body, { status: answer.status })
  }) as unknown as typeof fetch
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(GamePatchesPanel, {
          row: { id: 'inn', patches, chosenTake: null, ...shape } as ImageRow,
        }),
      ),
    )
  })
  // The patches' view is loaded after the first render.
  for (let i = 0; i < 3; i++) await act(async () => await new Promise((r) => setTimeout(r, 5)))
  cleanups.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  return { host, sent }
}

const pickButtons = (host: Element) => [
  ...host.querySelectorAll<HTMLButtonElement>('button.patch-pick'),
]
const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

/** Types into a textarea and leaves it. */
async function reword(field: HTMLTextAreaElement, words: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  await act(async () => {
    set.call(field, words)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    field.dispatchEvent(new Event('blur'))
  })
  for (let i = 0; i < 3; i++) await act(async () => await new Promise((r) => setTimeout(r, 5)))
}

describe('GamePatchesPanel', () => {
  describe('while the images lock cannot be read', () => {
    const two = () => [patch('a', { chosenOn: [1] }), patch('b')]
    const heading = (host: Element) =>
      text(host.querySelector('.patches-chips .label, .patches-side h3'))
    it('heads a wide picture’s chips with the count asked for and shows no dots', async () => {
      const { host } = await render(two(), undefined, { lockUnread: true }, { chosenTake: 1 })
      expect(heading(host)).toBe('Patches · 2')
      expect(host.querySelectorAll('.patch-pick .dot').length).toBe(0)
      expect(pickButtons(host).map((b) => text(b))).toEqual(['Title of a', 'Title of b'])
    })
    it('heads a tall picture’s list the same way', async () => {
      const shape = { chosenTake: 1, width: 600, height: 800 }
      const { host } = await render(two(), undefined, { lockUnread: true }, shape)
      expect(heading(host)).toBe('Patches · 2')
      expect(pickButtons(host).length).toBe(2)
      expect(host.querySelectorAll('.patch-pick-row .mono').length).toBe(2)
    })
    it('keeps the count of chosen and the dots when the lock is readable', async () => {
      const { host } = await render(two(), undefined, {}, { chosenTake: 1 })
      expect(heading(host)).toBe('Patches · 1 of 2 chosen')
      expect(host.querySelectorAll('.patch-pick .dot').length).toBe(2)
      expect(host.querySelectorAll('.patch-pick .dot.ok').length).toBe(1)
    })
  })
  it('is not on the page for an image with no patches', async () => {
    const { host } = await render([])
    expect(host.innerHTML).toBe('')
  })

  it('opens the first patch on arrival, and lists every patch as a button that says which is open', async () => {
    const { host } = await render([patch('bread-taken'), patch('door-ajar')])
    expect(host.querySelector('section')!.getAttribute('aria-label')).toBe(
      'Patches the game asks for',
    )
    const picks = pickButtons(host)
    expect(picks.map((r) => r.getAttribute('aria-current'))).toEqual(['true', null])
    expect(host.querySelectorAll('textarea').length).toBe(1)
    expect(host.querySelector('textarea')!.value).toBe('Game words of bread-taken')
  })

  it('opens one patch at a time: another press swaps the open patch', async () => {
    const { host } = await render([patch('bread-taken'), patch('door-ajar')])
    await act(async () => pickButtons(host)[1]!.click())
    expect(pickButtons(host).map((r) => r.getAttribute('aria-current'))).toEqual([null, 'true'])
    expect(host.querySelectorAll('textarea').length).toBe(1)
    expect(host.querySelector('textarea')!.value).toBe('Game words of door-ajar')
    expect(text(host.querySelector('label'))).toBe('What should change')
    expect(text(host.querySelector('.field-tag'))).toBe('from the game')
  })

  it('lists the patches beside a portrait image: title, id and state, headed with how many are chosen', async () => {
    const { host } = await render(
      [patch('bread-taken', { chosenOn: [2] }), patch('door-ajar')],
      undefined,
      {
        patches: [
          { id: 'bread-taken', takes: [{ n: 1, chosen: true }], making: [], failed: [] },
          { id: 'door-ajar', takes: [], making: [], failed: [] },
        ],
      },
      { width: 600, height: 800, chosenTake: 2 },
    )
    expect(host.querySelector('.patches-chips')).toBeNull()
    const side = host.querySelector('.patches-side')!
    expect(text(side.querySelector('h3'))).toBe('Patches · 1 of 2 chosen')
    expect(pickButtons(host).map((r) => text(r))).toEqual([
      'Title of bread-takenbread-takenTake 1 chosen',
      'Title of door-ajardoor-ajarno takes yet',
    ])
  })

  it('puts the patches as a row of chips above a landscape or square image, the id as the tip', async () => {
    for (const size of [
      { width: 800, height: 600 },
      { width: 600, height: 600 },
    ]) {
      const { host } = await render(
        [patch('bread-taken', { chosenOn: [2] }), patch('door-ajar')],
        undefined,
        {},
        { ...size, chosenTake: 2 },
      )
      expect(host.querySelector('.patches-side')).toBeNull()
      const bar = host.querySelector('.patches-chips')!
      expect(text(bar.querySelector('.label'))).toBe('Patches · 1 of 2 chosen')
      expect(pickButtons(host).map((r) => text(r))).toEqual([
        'Title of bread-taken',
        'Title of door-ajar',
      ])
      expect(pickButtons(host).map((r) => r.title)).toEqual(['bread-taken', 'door-ajar'])
      expect(pickButtons(host).map((r) => r.querySelector('.dot')?.className)).toEqual([
        'dot ok',
        'dot',
      ])
    }
  })

  it('opens by itself, instead of the first, the patch whose game words changed', async () => {
    const { host } = await render([
      patch('bread-taken'),
      patch('door-ajar', { changed: true, gameChanged: true, gameWas: 'Old' }),
    ])
    expect(pickButtons(host).map((r) => r.getAttribute('aria-current'))).toEqual([null, 'true'])
  })

  it('marks a patch reworded here on its row in the list', async () => {
    const { host } = await render(
      [
        patch('bread-taken', {
          changed: true,
          words: 'Mine',
          gameWas: 'Game words of bread-taken',
        }),
      ],
      undefined,
      {},
      { width: 600, height: 800 },
    )
    expect(text(pickButtons(host)[0]!.querySelector('.game-patch-mark'))).toBe('changed here')
  })

  it('saves rewording when the field is left, shows Saved, and the game’s words', async () => {
    const { host, sent } = await render([patch('bread-taken')])
    await reword(host.querySelector('textarea')!, 'No bread at all')
    expect(sent).toEqual([
      {
        method: 'PATCH',
        path: '/api/images/inn/game-patches/bread-taken',
        body: { words: 'No bread at all' },
      },
    ])
    expect(text(host.querySelector('.saved'))).toBe('Saved')
  })

  it('marks a reworded patch on its closed row, and offers the game’s words back when open', async () => {
    const { host, sent } = await render([
      patch('bread-taken', { changed: true, words: 'Mine', gameWas: 'Game words of bread-taken' }),
    ])
    expect(text(host.querySelector('.field-tag'))).toBe("changed here · use the game's")
    expect(text(host.querySelector('.game-patch-body .muted'))).toBe(
      "The game's words: Game words of bread-taken",
    )
    await act(async () => host.querySelector<HTMLButtonElement>('.field-tag button')!.click())
    expect(sent[0]).toMatchObject({ body: { words: null } })
  })

  it('opens by itself a patch whose game words changed under the user’s, with the notice and both buttons', async () => {
    const { host, sent } = await render([
      patch('bread-taken'),
      patch('door-ajar', {
        changed: true,
        gameChanged: true,
        words: 'My door',
        description: 'New door words',
        gameWas: 'Old door words',
      }),
    ])
    expect(pickButtons(host).map((r) => r.getAttribute('aria-current'))).toEqual([null, 'true'])
    const notice = host.querySelector('.notice')!
    expect(text(notice.querySelector('strong'))).toBe(
      "The game changed this patch's words since you wrote your own.",
    )
    expect(text(notice)).toContain('Your words (used now)My door')
    expect(text(notice)).toContain("The game's new wordsNew door wordsBefore: Old door words")
    expect([...notice.querySelectorAll('button')].map((b) => text(b))).toEqual([
      "Use the game's",
      'Keep mine',
    ])
    expect(notice.querySelector('.btn-primary')?.textContent).toBe('Keep mine')
    await act(async () => notice.querySelectorAll('button')[1]!.click())
    expect(sent[0]).toEqual({
      method: 'POST',
      path: '/api/images/inn/game-patches/door-ajar/compare',
      body: { choice: 'keep' },
    })
  })

  it('settles with either button, keeps the patch open and moves focus to its field', async () => {
    const changed = patch('door-ajar', {
      changed: true,
      gameChanged: true,
      words: 'My door',
      gameWas: 'Old',
    })
    const { host, sent } = await render([changed])
    await act(async () => host.querySelector<HTMLButtonElement>('.btn:not(.btn-primary)')!.click())
    for (let i = 0; i < 3; i++) await act(async () => await new Promise((r) => setTimeout(r, 5)))
    expect(sent[0]).toEqual({
      method: 'POST',
      path: '/api/images/inn/game-patches/door-ajar/compare',
      body: { choice: 'game' },
    })
    expect(pickButtons(host)[0]!.getAttribute('aria-current')).toBe('true')
    expect(document.activeElement).toBe(host.querySelector('textarea'))
  })

  it('reports a compare that could not be saved', async () => {
    const { host } = await render(
      [patch('door-ajar', { changed: true, gameChanged: true, words: 'Mine', gameWas: 'Old' })],
      {
        status: 409,
        body: { ok: false, problems: [{ file: 'edits.json', path: '', message: 'nope' }] },
      },
    )
    await act(async () => host.querySelector<HTMLButtonElement>('.btn-primary')!.click())
    for (let i = 0; i < 3; i++) await act(async () => await new Promise((r) => setTimeout(r, 5)))
    expect(text(host.querySelector('.notice'))).toContain('nope')
  })

  it('reports a failed save under that patch’s field', async () => {
    const { host } = await render([patch('bread-taken')], {
      status: 409,
      body: {
        ok: false,
        problems: [
          { file: 'content-studio/images/edits.json', path: '', message: 'cannot be written' },
        ],
      },
    })
    await reword(host.querySelector('textarea')!, 'x')
    expect(text(host.querySelector('.game-patch-body'))).toContain('cannot be written')
    expect(host.querySelector('.saved')).toBeNull()
  })

  describe('overlapping chosen patches', () => {
    const at = (x: number) => ({ x, y: 0, width: 10, height: 10 })
    const three = () => [
      patch('bread-taken', { title: 'Bread taken', chosenArea: at(0) }),
      patch('door-ajar', { title: 'Door ajar', chosenArea: at(5) }),
      patch('fire-out', { title: 'Fire out', chosenArea: at(8) }),
    ]
    const warning = (host: Element) =>
      host.querySelector('section[aria-label="Overlapping patches"]')

    it('warns above the list, between the explanation and the patches, naming the one pair', async () => {
      const { host } = await render(three().slice(0, 2))
      const notice = warning(host)!
      expect(notice.className).toContain('notice-warn')
      expect(text(notice.querySelector('strong'))).toBe(
        'Two chosen patches overlap: Bread taken and Door ajar.',
      )
      expect(text(notice.querySelector('.muted'))).toBe(
        'If the game shows both at once, one is drawn over the other where they meet.',
      )
      expect(notice.nextElementSibling?.className).toContain('patches-layout')
      expect(notice.querySelectorAll('button, a, [tabindex]').length).toBe(0)
    })
    it('lists every pair under a shorter heading, in the game’s order', async () => {
      const { host } = await render(three())
      const notice = warning(host)!
      expect(text(notice.querySelector('strong'))).toBe('Some chosen patches overlap.')
      expect([...notice.querySelectorAll('li')].map((li) => text(li))).toEqual([
        'Bread taken and Door ajar',
        'Bread taken and Fire out',
        'Door ajar and Fire out',
      ])
    })
    it('says nothing when no pair overlaps, or the patches are not loaded, the chosen picture is gone or the lock cannot be read', async () => {
      const apart = [patch('a', { chosenArea: at(0) }), patch('b', { chosenArea: at(10) })]
      expect(warning((await render(apart)).host)).toBeNull()
      expect(warning((await render(three(), undefined, { pictureGone: true })).host)).toBeNull()
      expect(warning((await render(three(), undefined, { lockUnread: true })).host)).toBeNull()
      expect(warning((await render(three(), undefined, null)).host)).toBeNull()
    })
    it('puts one amber line at the top of an open patch, naming each patch it overlaps', async () => {
      const { host } = await render(three())
      const first = () => text(host.querySelector('.game-patch-body .line-warn'))
      expect(first()).toBe('The chosen take overlaps Door ajar and Fire out.')
      await act(async () => pickButtons(host)[1]!.click())
      expect(first()).toBe('The chosen take overlaps Bread taken and Fire out.')
      expect(host.querySelectorAll('.game-patch-body .line-warn').length).toBe(1)
      const body = host.querySelector('.game-patch-body')!
      expect(
        body.querySelector('.line-warn')!.nextElementSibling?.querySelector('textarea'),
      ).not.toBeNull()
    })
    it('puts no line in an open patch that overlaps nothing', async () => {
      const { host } = await render([...three().slice(0, 2), patch('far', { chosenArea: at(500) })])
      await act(async () => pickButtons(host)[2]!.click())
      expect(host.querySelector('.line-warn')).toBeNull()
    })
  })
})
