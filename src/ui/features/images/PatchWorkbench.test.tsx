import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ImagePatchesView, PatchWorkView } from '../../../core/imagePatches'
import type { ImageRow, PatchRow } from '../../../core/images'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const isOff = (element: Element) => element.getAttribute('aria-disabled') === 'true'
const { act, createElement } = await import('react')
const { WhyTip } = await import('../../components/WhyTip')
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

const patchRow = (id: string, over: Partial<PatchRow> = {}): PatchRow => ({
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

const area = { x: 100, y: 50, width: 200, height: 200 }
const other = { x: 400, y: 300, width: 100, height: 80 }

const takeOf = (n: number, over: Partial<PatchWorkView['takes'][number]> = {}) => ({
  n,
  area,
  earlier: false,
  chosen: false,
  isNew: false,
  look: 'ready' as const,
  model: 'klein' as const,
  kept: null,
  ...over,
})

const work = (id: string, over: Partial<PatchWorkView> = {}): PatchWorkView => ({
  id,
  takes: [],
  making: [],
  failed: [],
  oldLook: false,
  failedModels: [],
  ...over,
})

const view = (
  patches: PatchWorkView[],
  over: Partial<ImagePatchesView> = {},
): ImagePatchesView => ({
  ok: true,
  take: { n: 3, width: 1024, height: 576, cropped: false },
  game: { width: 512, height: 288 },
  lookError: null,
  lookKey: 'k',
  lockUnread: false,
  pictureGone: false,
  remake: { earlier: {}, press: null, failedModels: [] },
  maker: { ok: true },
  models: { 'qwen-edit': 'whole', klein: 'whole' },
  patches,
  ...over,
})

/**
 * Renders the panel of image `inn` over a server answering the patches `current()` and every
 * change `posted`; gives the element and the requests sent.
 */
async function render(
  patches: PatchRow[],
  current: () => ImagePatchesView,
  posted: { status: number; body: unknown } = { status: 200, body: { ok: true } },
  imageRow: Partial<ImageRow> = {},
) {
  const sent: { method: string; path: string; body: unknown }[] = []
  globalThis.fetch = (async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET') return Response.json(current())
    sent.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null })
    return Response.json(posted.body, { status: posted.status })
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
        createElement(WhyTip),
        createElement(GamePatchesPanel, {
          row: { id: 'inn', width: 1024, height: 576, areas: [], patches, ...imageRow } as ImageRow,
        }),
      ),
    )
  })
  await settle()
  cleanups.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  return { host, sent, root, client, rerender: (row: Partial<ImageRow>) => renderRow(row) }
  function renderRow(row: Partial<ImageRow>) {
    return act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(WhyTip),
          createElement(GamePatchesPanel, {
            row: { id: 'inn', width: 1024, height: 576, areas: [], patches, ...row } as ImageRow,
          }),
        ),
      )
    })
  }
}

/** Lets what the page asked for arrive. */
async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => await new Promise((r) => setTimeout(r, 5)))
}

/** The words in an element, those of neighbouring elements told apart by a space. */
function words(node: Node): string {
  return node.nodeType === 3
    ? (node.textContent ?? '')
    : [...node.childNodes].map((child) => words(child)).join(' ')
}
const text = (el: Element | null | undefined) => (el ? words(el).replace(/\s+/g, ' ').trim() : '')
const rows = (host: Element) => [
  ...host.querySelectorAll<HTMLButtonElement>('button.game-patch-row'),
]
const button = (host: Element, name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === name)
const stageOf = (host: Element): HTMLElement => {
  const stage = host.querySelector<HTMLElement>('.patch-stage')!
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1024, height: 576 }) as DOMRect
  stage.setPointerCapture = () => {}
  return stage
}
const pointer = (stage: Element, type: string, x: number, y: number) =>
  stage.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }))
async function drag(stage: Element, from: [number, number], to: [number, number]) {
  await act(async () => pointer(stage, 'pointerdown', ...from))
  await act(async () => pointer(stage, 'pointermove', ...to))
  await act(async () => pointer(stage, 'pointerup', ...to))
}
const key = (target: Element, name: string) =>
  act(async () => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
    )
  })
const thumbs = (host: Element) => [
  ...host.querySelectorAll<HTMLButtonElement>('button.patch-thumb'),
]
const open = async (host: Element, at = 0) => act(async () => rows(host)[at]!.click())
const heading = (host: Element) => text(host.querySelector('.patch-looking'))

describe('the closed rows of the patches', () => {
  it('say how far each patch has come, after any “changed here” mark', async () => {
    const { host } = await render(
      [
        patchRow('a'),
        patchRow('b', { changed: true, words: 'Mine' }),
        patchRow('c'),
        patchRow('d'),
      ],
      () =>
        view([
          work('a'),
          work('b', { takes: [takeOf(1), takeOf(2)] }),
          work('c', { takes: [takeOf(1, { chosen: true }), takeOf(2), takeOf(3)] }),
          work('d', { takes: [takeOf(4)] }),
        ]),
    )
    expect(rows(host).map((r) => text(r))).toEqual([
      '▸ Title of a a no takes yet',
      '▸ Title of b b changed here 2 takes, none chosen',
      '▸ Title of c c 3 takes Take 1 chosen',
      '▸ Title of d d 1 take, none chosen',
    ])
    expect(host.querySelector('.game-patch-end .chip')?.textContent).toBe('Take 1 chosen')
  })
})

describe('an open patch with nothing to patch on', () => {
  it('asks to choose a take of the image first, with only the words field', async () => {
    const { host } = await render([patchRow('a')], () => view([work('a')], { take: null }))
    await open(host)
    expect(host.querySelector('textarea')).not.toBeNull()
    expect(text(host)).toContain(
      'Choose a take of the image first. Patches are painted onto the take the game shows.',
    )
    expect(host.querySelector('.patch-stage')).toBeNull()
    expect(button(host, 'Make 2 takes')).toBeUndefined()
  })

  it('says the picture is missing', async () => {
    const { host } = await render([patchRow('a')], () =>
      view([work('a')], { take: null, pictureGone: true }),
    )
    await open(host)
    expect(text(host)).toContain(
      "The chosen take's picture is missing or cannot be read, so it cannot be patched.",
    )
    expect(host.querySelector('.patch-stage')).toBeNull()
  })

  it('has no Make and no tries of the old trial on the page', async () => {
    const { host } = await render([patchRow('a')], () => view([work('a')]))
    expect(text(host)).not.toContain('Try a patch of your own')
  })
})

describe('an open patch with no takes', () => {
  const none = () => view([work('a')])

  it('shows the chosen take of the image alone, the hint, Make off and the empty line', async () => {
    const { host } = await render([patchRow('a')], none)
    await open(host)
    expect(heading(host)).toBe('The chosen take of the image')
    const base = host.querySelector<HTMLImageElement>('img.patch-take')!
    expect(base.getAttribute('src')).toStartWith('/api/images/inn/takes/3/game')
    expect(host.querySelector('img.patch-over')).toBeNull()
    expect(text(host)).toContain('Drag over the picture to mark what should change.')
    expect(isOff(button(host, 'Make 2 takes')!)).toBe(true)
    expect(button(host, 'Make 2 takes')!.dataset.why).toBe(
      'This patch has no mark yet. Drag over the picture to mark where it goes.',
    )
    expect(text(host)).toContain(
      'No takes yet. Each take is a new try at this change, painted with the part of the picture around the mark in view.',
    )
    expect(text(host)).toContain('Takes')
    expect(text(host)).not.toContain('Takes ·')
  })

  it('draws the dashes when an area is marked, turns Make on and drops the hint', async () => {
    const { host } = await render([patchRow('a')], none)
    await open(host)
    await drag(stageOf(host), [100, 50], [300, 250])
    expect(host.querySelector('.patch-mark')).not.toBeNull()
    expect(isOff(button(host, 'Make 2 takes')!)).toBe(false)
    expect(text(host)).not.toContain('Drag over the picture')
  })

  it('replaces the mark by a new drag, and keeps it through a click', async () => {
    const { host } = await render([patchRow('a')], none)
    await open(host)
    const stage = stageOf(host)
    await drag(stage, [100, 50], [300, 250])
    const style = () => (host.querySelector('.patch-mark') as HTMLElement).style.left
    expect(style()).toBe(`${(100 / 1024) * 100}%`)
    await drag(stage, [400, 300], [500, 380])
    expect(style()).toBe(`${(400 / 1024) * 100}%`)
    await drag(stage, [10, 10], [10, 10])
    expect(style()).toBe(`${(400 / 1024) * 100}%`)
  })

  it('stops the drag at the picture’s edges', async () => {
    const { host, sent } = await render([patchRow('a')], none)
    await open(host)
    await drag(stageOf(host), [900, 500], [2000, 2000])
    await act(async () => button(host, 'Make 2 takes')!.click())
    expect(sent[0]!.body).toEqual({
      count: 2,
      area: { x: 900, y: 500, width: 124, height: 76 },
      model: 'klein',
    })
  })

  it('asks for the chosen number of takes of the marked area', async () => {
    const { host, sent } = await render([patchRow('a')], none)
    await open(host)
    await drag(stageOf(host), [100, 50], [300, 250])
    const menu = host.querySelector<HTMLSelectElement>('select[aria-label="Number of new takes"]')!
    expect([...menu.options].map((o) => o.textContent)).toEqual([
      '1 take',
      '2 takes',
      '3 takes',
      '4 takes',
    ])
    expect(menu.value).toBe('2')
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    await act(async () => {
      set.call(menu, '3')
      menu.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => button(host, 'Make 3 takes')!.click())
    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/api/images/inn/patches/a/takes',
        body: { count: 3, area, model: 'klein' },
      },
    ])
  })

  it('keeps the mark through closing and opening the row, per patch', async () => {
    const { host } = await render([patchRow('a'), patchRow('b')], () =>
      view([work('a'), work('b')]),
    )
    await open(host, 0)
    await drag(stageOf(host), [100, 50], [300, 250])
    await open(host, 0)
    expect(host.querySelector('.patch-stage')).toBeNull()
    await open(host, 0)
    expect(host.querySelector('.patch-mark')).not.toBeNull()
    await open(host, 1)
    expect(host.querySelectorAll('.patch-mark').length).toBe(1)
  })

  it('says the model is missing under Make, and leaves it off', async () => {
    const message = 'FLUX.2 klein 4B is not on this computer, and patches are made with it.'
    const { host } = await render([patchRow('a')], () =>
      view([work('a')], { maker: { ok: false, message } }),
    )
    await open(host)
    await drag(stageOf(host), [100, 50], [300, 250])
    expect(text(host)).toContain(message)
    expect(isOff(button(host, 'Make 2 takes')!)).toBe(true)
    expect(button(host, 'Make 2 takes')!.dataset.why).toBe(message)
  })
})

describe('an open patch with takes', () => {
  const made =
    (over: Partial<PatchWorkView> = {}) =>
    () =>
      view([
        work('a', {
          takes: [takeOf(1), takeOf(2, { chosen: true }), takeOf(3, { area: other })],
          ...over,
        }),
      ])

  it('opens on the chosen take, else the newest, with the heading and the chip', async () => {
    const { host } = await render([patchRow('a')], made())
    await open(host)
    expect(heading(host)).toBe('Looking at Take 2 FLUX.2 klein Chosen')
    expect(host.querySelector('img.patch-over')!.getAttribute('src')).toStartWith(
      '/api/images/inn/patches/a/takes/2/game',
    )
    const none = await render([patchRow('a')], () =>
      view([work('a', { takes: [takeOf(1), takeOf(2)] })]),
    )
    await open(none.host)
    expect(heading(none.host)).toBe('Looking at Take 2 FLUX.2 klein')
  })

  it('frames each take’s close-up on what that take keeps, the mark alone for the rest', async () => {
    const tall = { x: 150, y: 0, width: 40, height: 500 }
    const { host } = await render([patchRow('a')], () =>
      view([
        work('a', {
          takes: [takeOf(1, { kept: tall }), takeOf(2), takeOf(3, { kept: { ...area } })],
        }),
      ]),
    )
    await open(host)
    const ratios = [...host.querySelectorAll<HTMLElement>('.patch-thumb .patch-closeup')].map(
      (c) => c.style.aspectRatio,
    )
    // Take 1: the change runs the picture's height; widened from 300 x 576 to the tallest shape (here in the game's version, half the size).
    // Takes 2 and 3: the mark and a quarter round it, the same frame.
    expect(ratios).toEqual(['192 / 288', '150 / 150', '150 / 150'])
  })

  it('leaves the other close-ups as they were when a take lands, and frames a take still being made on the mark', async () => {
    const tall = { x: 150, y: 0, width: 40, height: 500 }
    let takes = [takeOf(1, { kept: tall })]
    const { host } = await render([patchRow('a')], () =>
      view([
        work('a', {
          takes,
          making:
            takes.length === 1
              ? [{ n: 2, state: 'making', elapsed: 1, expected: 15, area, model: 'klein' }]
              : [],
        }),
      ]),
    )
    await open(host)
    const ratios = () =>
      [...host.querySelectorAll<HTMLElement>('.patch-thumb .patch-closeup')].map(
        (c) => c.style.aspectRatio,
      )
    // The take being made is framed on the mark.
    expect(ratios()).toEqual(['192 / 288', '150 / 150'])
    takes = [
      takeOf(1, { kept: tall }),
      takeOf(2, { kept: { x: 100, y: 50, width: 300, height: 100 } }),
    ]
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(ratios()[0]).toBe('192 / 288')
  })

  it('heads the takes with their count and explains how to look at one', async () => {
    const { host } = await render([patchRow('a')], made())
    await open(host)
    expect(text(host)).toContain('Takes · 3')
    expect(text(host)).toContain('Press a take, or use ← →, to lay it over the picture.')
    expect(thumbs(host).map((t) => text(t))).toEqual([
      'Take 1 FLUX.2 klein',
      'Take 2 Chosen FLUX.2 klein',
      'Take 3 FLUX.2 klein',
    ])
    expect(text(host)).not.toContain('No takes yet.')
  })

  it('lays a pressed take over the picture, makes its area the mark and hides the dashes when they agree', async () => {
    const { host } = await render([patchRow('a')], made())
    await open(host)
    await act(async () => thumbs(host)[2]!.click())
    expect(heading(host)).toBe('Looking at Take 3 FLUX.2 klein')
    expect(host.querySelector('.patch-mark')).toBeNull()
    await drag(stageOf(host), [10, 10], [200, 200])
    expect(host.querySelector('.patch-mark')).not.toBeNull()
    await act(async () => thumbs(host)[0]!.click())
    expect(host.querySelector('.patch-mark')).toBeNull()
  })

  it('takes the patch off and puts it back with the switch, the dashes showing while it is off', async () => {
    const { host } = await render([patchRow('a')], made())
    await open(host)
    await act(async () => thumbs(host)[0]!.click())
    const switchBox = host.querySelector<HTMLInputElement>('input.patch-switch')!
    expect(switchBox.checked).toBe(true)
    expect(text(switchBox.closest('label'))).toBe('Show the patch')
    await act(async () => switchBox.click())
    expect(host.querySelector('img.patch-over')).toBeNull()
    expect(host.querySelector('.patch-mark')).not.toBeNull()
    expect(heading(host)).toBe('Looking at Take 1 FLUX.2 klein')
    await act(async () => switchBox.click())
    expect(host.querySelector('img.patch-over')).not.toBeNull()
    expect(host.querySelector('.patch-mark')).toBeNull()
  })

  it('offers Drop and Choose for a take that is not chosen, and Un-choose for the chosen one', async () => {
    const { host } = await render([patchRow('a')], made())
    await open(host)
    expect(button(host, 'Un-choose')).not.toBeUndefined()
    expect(button(host, 'Choose')).toBeUndefined()
    expect(button(host, 'Drop')).toBeUndefined()
    await act(async () => thumbs(host)[0]!.click())
    expect(button(host, 'Choose')).not.toBeUndefined()
    expect(button(host, 'Drop')).not.toBeUndefined()
    expect(button(host, 'Un-choose')).toBeUndefined()
    expect(text(host)).toContain('or press D to drop, C to choose, S to turn the patch off and on')
  })

  it('chooses and drops at once, with no question', async () => {
    const { host, sent } = await render([patchRow('a')], made())
    await open(host)
    await act(async () => thumbs(host)[0]!.click())
    await act(async () => button(host, 'Choose')!.click())
    await act(async () => button(host, 'Drop')!.click())
    expect(sent.map((s) => [s.method, s.path, s.body])).toEqual([
      ['POST', '/api/images/inn/patches/a/choose', { n: 1 }],
      ['DELETE', '/api/images/inn/patches/a/takes/1', null],
    ])
  })

  it('has the project reloaded after a choice, so the act’s row follows what was saved', async () => {
    const { host, client } = await render([patchRow('a')], made())
    client.setQueryData(['project'], {})
    await open(host)
    await act(async () => thumbs(host)[0]!.click())
    expect(client.getQueryState(['project'])?.isInvalidated).toBe(false)
    await act(async () => button(host, 'Choose')!.click())
    expect(client.getQueryState(['project'])?.isInvalidated).toBe(true)
  })

  it('leaves the project alone when a take is only marked as seen', async () => {
    const { host, client } = await render([patchRow('a')], made())
    client.setQueryData(['project'], {})
    await open(host)
    await act(async () => thumbs(host)[0]!.click())
    await settle()
    expect(client.getQueryState(['project'])?.isInvalidated).toBe(false)
  })

  it('asks before un-choosing, in the picture’s place, and Cancel gives focus back', async () => {
    const { host, sent } = await render([patchRow('a')], made())
    await open(host)
    await act(async () => button(host, 'Un-choose')!.click())
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(text(host)).toContain('Un-choose take 2?')
    expect(text(host)).toContain(
      'The game shows the image without this patch until you choose another. Take 2 stays among the takes.',
    )
    expect(host.querySelector('.patch-stage')).toBeNull()
    expect(document.activeElement).toBe(
      button(host.querySelector('[role="alertdialog"]')!, 'Un-choose') ?? null,
    )
    await act(async () => button(host, 'Cancel')!.click())
    await settle()
    expect(host.querySelector('[role="alertdialog"]')).toBeNull()
    expect(sent).toEqual([])
    expect(document.activeElement).toBe(button(host, 'Un-choose') ?? null)
    await act(async () => button(host, 'Un-choose')!.click())
    await act(async () => button(host.querySelector('[role="alertdialog"]')!, 'Un-choose')!.click())
    expect(sent.map((s) => [s.method, s.path])).toEqual([
      ['POST', '/api/images/inn/patches/a/unchoose'],
    ])
  })

  it('marks a take that was made from earlier words, and one not yet looked at', async () => {
    const { host } = await render([patchRow('a')], () =>
      view([
        work('a', {
          takes: [takeOf(1, { earlier: true }), takeOf(2, { isNew: true }), takeOf(3)],
        }),
      ]),
    )
    await open(host)
    // Opens on the newest take, which is looked at; take 2 is not.
    expect(thumbs(host).map((t) => text(t))).toEqual([
      'Take 1 earlier words FLUX.2 klein',
      'Take 2 new FLUX.2 klein',
      'Take 3 FLUX.2 klein',
    ])
  })

  it('records that a take looked at is no longer new', async () => {
    const { host, sent } = await render([patchRow('a')], () =>
      view([work('a', { takes: [takeOf(1, { isNew: true })] })]),
    )
    await open(host)
    await settle()
    expect(sent.map((s) => [s.method, s.path])).toEqual([
      ['POST', '/api/images/inn/patches/a/takes/1/seen'],
    ])
  })

  it('shows the make button as “more” once there are takes', async () => {
    const { host } = await render([patchRow('a')], made())
    await open(host)
    expect(button(host, 'Make 2 more takes')).not.toBeUndefined()
  })

  it('does not move the picture when another take arrives, and gives it the new chip', async () => {
    let takes = [takeOf(1), takeOf(2)]
    const { host } = await render([patchRow('a')], () => view([work('a', { takes })]))
    await open(host)
    expect(heading(host)).toBe('Looking at Take 2 FLUX.2 klein')
    await act(async () => thumbs(host)[0]!.click())
    takes = [...takes, takeOf(3, { isNew: true })]
    // The page asks for the patches again when it makes or changes something.
    await act(async () => button(host, 'Drop')!.click())
    await settle()
    expect(heading(host)).toBe('Looking at Take 2 FLUX.2 klein')
  })
})

describe('keys inside a patch', () => {
  const made = () =>
    view([
      work('a', { takes: [takeOf(1), takeOf(2, { chosen: true }), takeOf(3, { area: other })] }),
    ])

  it('step the takes with ← and →, stopping at the ends', async () => {
    const { host } = await render([patchRow('a')], made)
    await open(host)
    const focus = thumbs(host)[1]!
    focus.focus()
    await key(focus, 'ArrowRight')
    expect(heading(host)).toBe('Looking at Take 3 FLUX.2 klein')
    await key(focus, 'ArrowRight')
    expect(heading(host)).toBe('Looking at Take 3 FLUX.2 klein')
    await key(focus, 'ArrowLeft')
    await key(focus, 'ArrowLeft')
    await key(focus, 'ArrowLeft')
    expect(heading(host)).toBe('Looking at Take 1 FLUX.2 klein')
  })

  it('choose with C, drop with D, and turn the patch off and on with S', async () => {
    const { host, sent } = await render([patchRow('a')], made)
    await open(host)
    const focus = thumbs(host)[0]!
    await key(focus, 'ArrowLeft')
    await key(focus, 'c')
    await key(focus, 'd')
    expect(sent.map((s) => [s.method, s.path])).toEqual([
      ['POST', '/api/images/inn/patches/a/choose'],
      ['DELETE', '/api/images/inn/patches/a/takes/1'],
    ])
    await key(focus, 's')
    expect(host.querySelector('img.patch-over')).toBeNull()
    await key(focus, 'S')
    expect(host.querySelector('img.patch-over')).not.toBeNull()
  })

  it('do nothing while typing in the words field', async () => {
    const { host, sent } = await render([patchRow('a')], made)
    await open(host)
    const field = host.querySelector('textarea')!
    await key(field, 'ArrowLeft')
    await key(field, 'd')
    await key(field, 's')
    expect(heading(host)).toBe('Looking at Take 2 FLUX.2 klein Chosen')
    expect(host.querySelector('img.patch-over')).not.toBeNull()
    expect(sent).toEqual([])
  })

  it('rest the image’s own keys while focus is inside, and leave them to the page elsewhere', async () => {
    const { host } = await render([patchRow('a')], made)
    await open(host)
    const heard: string[] = []
    const listen = (event: KeyboardEvent) => heard.push(event.key)
    document.addEventListener('keydown', listen)
    cleanups.push(() => document.removeEventListener('keydown', listen))
    await key(thumbs(host)[0]!, 'd')
    await key(thumbs(host)[0]!, 'c')
    expect(heard).toEqual([])
    await key(document.body, 'd')
    expect(heard).toEqual(['d'])
  })
})

describe('keys and focus around the question and Make', () => {
  const made = () => view([work('a', { takes: [takeOf(1, { chosen: true }), takeOf(2)] })])

  it('keep the image’s own keys at rest while the Un-choose question is open', async () => {
    const { host, sent } = await render([patchRow('a')], made)
    await open(host)
    await act(async () => button(host, 'Un-choose')!.click())
    const heard: string[] = []
    const listen = (event: KeyboardEvent) => heard.push(event.key)
    document.addEventListener('keydown', listen)
    cleanups.push(() => document.removeEventListener('keydown', listen))
    const cancel = button(host, 'Cancel')!
    await key(cancel, 'd')
    await key(cancel, 'c')
    await key(cancel, 'ArrowLeft')
    expect(heard).toEqual([])
    expect(sent).toEqual([])
  })

  it('puts focus on the take looked at when Make is pressed', async () => {
    const { host } = await render([patchRow('a')], made)
    await open(host)
    await drag(stageOf(host), [100, 50], [300, 250])
    await act(async () => button(host, 'Make 2 more takes')!.click())
    await settle()
    expect(document.activeElement).toBe(thumbs(host)[0] ?? null)
  })

  it('reloads the patches when a take of the image is chosen, dropped or un-chosen', async () => {
    const { useChooseImageTake } = await import('../../api')
    const client = new QueryClient()
    const asked: unknown[] = []
    client.invalidateQueries = (async (filters: { queryKey?: unknown }) => {
      asked.push(filters.queryKey)
    }) as typeof client.invalidateQueries
    globalThis.fetch = (async () => Response.json({ ok: true })) as unknown as typeof fetch
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let choose: ReturnType<typeof useChooseImageTake> | undefined
    const Probe = () => {
      choose = useChooseImageTake('inn')
      return null
    }
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(Probe)))
    })
    cleanups.push(() => {
      act(() => root.unmount())
      host.remove()
    })
    await act(async () => {
      choose!.mutate(2)
    })
    await settle()
    expect(asked).toContainEqual(['image-patches', 'inn'])
    // The fine-tunes belong to the picture in the game, which a choice changes.
    expect(asked).toContainEqual(['image-fine-tunes', 'inn'])
  })
})

describe('takes being made and failed', () => {
  it('shows a take waiting, with the Stop button, and turns Make off', async () => {
    const { host, sent } = await render([patchRow('a')], () =>
      view([
        work('a', {
          takes: [takeOf(1)],
          making: [
            { n: 2, state: 'waiting', elapsed: 0, expected: 15, area, model: 'klein' },
            { n: 3, state: 'making', elapsed: 5, expected: 15, area, model: 'klein' },
          ],
        }),
      ]),
    )
    await open(host)
    expect(text(host)).toContain('Takes · 1')
    const waiting = host.querySelectorAll('.patch-thumb-making')
    expect([...waiting].map((w) => text(w).replace(/ making.*$/, ''))).toEqual([
      'Take 2 FLUX.2 klein waiting',
      'Take 3 FLUX.2 klein',
    ])
    expect(host.querySelectorAll('[role="progressbar"]').length).toBe(2)
    expect(isOff(button(host, 'Make 2 more takes')!)).toBe(true)
    await act(async () => button(host, 'Stop')!.click())
    expect(sent.map((s) => [s.method, s.path])).toEqual([
      ['POST', '/api/images/inn/patches/a/stop'],
    ])
  })

  it('puts focus on Make once Stop has ended the takes', async () => {
    let stopped = false
    const { host } = await render([patchRow('a')], () =>
      view([
        work('a', {
          takes: [takeOf(1)],
          making: stopped
            ? []
            : [{ n: 2, state: 'making', elapsed: 5, expected: 15, area, model: 'klein' }],
        }),
      ]),
    )
    await open(host)
    await drag(stageOf(host), [100, 50], [300, 250])
    stopped = true
    await act(async () => button(host, 'Stop')!.click())
    await settle()
    expect(document.activeElement).toBe(button(host, 'Make 2 more takes')!)
  })

  it('shows a take that could not be made, with the others kept, and tries it again', async () => {
    const { host, sent } = await render([patchRow('a')], () =>
      view([
        work('a', {
          takes: [takeOf(1)],
          failed: [
            { n: 4, message: 'The image generator ran out of memory.', area, model: 'klein' },
          ],
        }),
      ]),
    )
    await open(host)
    const box = host.querySelector('.errbox')!
    expect(text(box)).toContain('Take 4 could not be made.')
    expect(text(box)).toContain('The image generator ran out of memory. Your other takes are kept.')
    await act(async () => button(box, 'Try again')!.click())
    expect(sent.map((s) => [s.method, s.path, s.body])).toEqual([
      ['POST', '/api/images/inn/patches/a/takes', { retry: 4 }],
    ])
  })

  it('does not promise other takes when there are none', async () => {
    const { host } = await render([patchRow('a')], () =>
      view([work('a', { failed: [{ n: 1, message: 'Out of memory.', area, model: 'klein' }] })]),
    )
    await open(host)
    expect(text(host.querySelector('.errbox'))).not.toContain('Your other takes are kept.')
  })

  it('shows a refusal of Make in the patch', async () => {
    const { host } = await render([patchRow('a')], () => view([work('a')]), {
      status: 409,
      body: { ok: false, message: 'Takes of this patch are being made.' },
    })
    await open(host)
    await drag(stageOf(host), [100, 50], [300, 250])
    await act(async () => button(host, 'Make 2 takes')!.click())
    await settle()
    expect(text(host)).toContain('Takes of this patch are being made.')
  })
})

describe('a patch tied to a named area', () => {
  const bucket = {
    id: 'bucket',
    title: 'Bucket',
    placed: true,
    box: { x: 100, y: 100, width: 200, height: 150 },
    boxes: {},
    elsewhere: [],
    elsewhereGone: false,
  }
  const unplaced = { ...bucket, placed: false, box: null }
  const grown = { left: `${((100 - 24) / 1024) * 100}%`, width: `${((200 + 48) / 1024) * 100}%` }
  const tied = () => [patchRow('a', { area: 'bucket' })]
  const none = () => view([work('a')])
  const markLeft = (host: Element) =>
    (host.querySelector('.patch-mark') as HTMLElement | null)?.style.left
  const LINE =
    'Marked from the named area “Bucket”, with a little room around it. Drag over the picture to change it.'
  const NOPLACE =
    '“Bucket” has no place yet. Mark it under Named areas and this patch starts there, or drag over the picture to mark this patch by hand.'
  const HINT = 'Drag over the picture to mark what should change.'

  it('opens marked at the area grown by the feather, with the line, Make on and no hint', async () => {
    const { host } = await render(tied(), none, undefined, { areas: [bucket] })
    await open(host)
    const mark = host.querySelector<HTMLElement>('.patch-mark')!
    expect(mark.style.left).toBe(grown.left)
    expect(mark.style.width).toBe(grown.width)
    expect(text(host)).toContain(LINE)
    expect(text(host)).not.toContain(HINT)
    expect(isOff(button(host, 'Make 2 takes')!)).toBe(false)
    expect(button(host, 'Back to “Bucket”')).toBeUndefined()
  })

  it('makes takes of the grown mark', async () => {
    const { host, sent } = await render(tied(), none, undefined, { areas: [bucket] })
    await open(host)
    await act(async () => button(host, 'Make 2 takes')!.click())
    expect(sent[0]!.body).toEqual({
      count: 2,
      area: { x: 76, y: 76, width: 248, height: 198 },
      model: 'klein',
    })
  })

  it('puts the line and the button before the number menu, so Tab reaches them first', async () => {
    const { host } = await render(tied(), none, undefined, { areas: [bucket] })
    await open(host)
    const line = [...host.querySelectorAll('p, span')].find((e) => text(e) === LINE)!
    const menu = host.querySelector('select.takes-count')!
    expect(line.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('replaces the line by Back to the area once dragged; the button restores it and focuses Make', async () => {
    const { host } = await render(tied(), none, undefined, { areas: [bucket] })
    await open(host)
    await drag(stageOf(host), [400, 300], [500, 380])
    expect(markLeft(host)).toBe(`${(400 / 1024) * 100}%`)
    expect(text(host)).not.toContain(LINE)
    const back = button(host, 'Back to “Bucket”')!
    await act(async () => back.click())
    expect(markLeft(host)).toBe(grown.left)
    expect(text(host)).toContain(LINE)
    expect(button(host, 'Back to “Bucket”')).toBeUndefined()
    expect(document.activeElement).toBe(button(host, 'Make 2 takes') ?? null)
  })

  it('shows the no-place line, Make off, and a hand mark with no button, when the area is not placed', async () => {
    const { host } = await render(tied(), none, undefined, { areas: [unplaced] })
    await open(host)
    expect(host.querySelector('.patch-mark')).toBeNull()
    expect(text(host)).toContain(NOPLACE)
    expect(text(host)).not.toContain(HINT)
    expect(isOff(button(host, 'Make 2 takes')!)).toBe(true)
    expect(button(host, 'Make 2 takes')!.dataset.why).toBe(
      '“Bucket” has no place yet. Mark it under Named areas, or drag over the picture to mark this patch.',
    )
    await drag(stageOf(host), [400, 300], [500, 380])
    expect(isOff(button(host, 'Make 2 takes')!)).toBe(false)
    expect(button(host, 'Back to “Bucket”')).toBeUndefined()
    expect(text(host)).not.toContain(NOPLACE)
  })

  it('follows the area while the mark is not the person’s own: placed, moved, cleared', async () => {
    const r = await render(tied(), none, undefined, { areas: [unplaced] })
    await open(r.host)
    await r.rerender({ areas: [bucket] })
    expect(markLeft(r.host)).toBe(grown.left)
    expect(text(r.host)).toContain(LINE)
    await r.rerender({ areas: [{ ...bucket, box: { x: 300, y: 100, width: 200, height: 150 } }] })
    expect(markLeft(r.host)).toBe(`${((300 - 24) / 1024) * 100}%`)
    await r.rerender({ areas: [unplaced] })
    expect(r.host.querySelector('.patch-mark')).toBeNull()
    expect(text(r.host)).toContain(NOPLACE)
    expect(isOff(button(r.host, 'Make 2 takes')!)).toBe(true)
  })

  it('keeps the person’s own mark when the area moves, offering Back to the new place; clearing removes the button', async () => {
    const r = await render(tied(), none, undefined, { areas: [bucket] })
    await open(r.host)
    await drag(stageOf(r.host), [400, 300], [500, 380])
    await r.rerender({ areas: [{ ...bucket, box: { x: 300, y: 100, width: 200, height: 150 } }] })
    expect(markLeft(r.host)).toBe(`${(400 / 1024) * 100}%`)
    await act(async () => button(r.host, 'Back to “Bucket”')!.click())
    expect(markLeft(r.host)).toBe(`${((300 - 24) / 1024) * 100}%`)
    await drag(stageOf(r.host), [400, 300], [500, 380])
    await r.rerender({ areas: [unplaced] })
    expect(markLeft(r.host)).toBe(`${(400 / 1024) * 100}%`)
    expect(button(r.host, 'Back to “Bucket”')).toBeUndefined()
  })

  it('makes a pressed take’s area the person’s own mark, even when it is the same place', async () => {
    const same = { x: 76, y: 76, width: 248, height: 198 }
    const made = () => view([work('a', { takes: [takeOf(1, { area: same }), takeOf(2)] })])
    const r = await render(tied(), made, undefined, { areas: [bucket] })
    await open(r.host)
    await act(async () => thumbs(r.host)[0]!.click())
    expect(text(r.host)).toContain(LINE)
    expect(button(r.host, 'Back to “Bucket”')).toBeUndefined()
    await r.rerender({ areas: [{ ...bucket, box: { x: 300, y: 100, width: 200, height: 150 } }] })
    // The mark stayed where it was, so the line is gone and the way back is offered.
    expect(text(r.host)).not.toContain(LINE)
    expect(button(r.host, 'Back to “Bucket”')).toBeDefined()
    await act(async () => thumbs(r.host)[1]!.click())
    expect(button(r.host, 'Back to “Bucket”')).toBeDefined()
  })

  it('starts from the area again when coming back to a patch with takes and no mark', async () => {
    const made = () => view([work('a', { takes: [takeOf(1)] })])
    const { host } = await render(tied(), made, undefined, { areas: [bucket] })
    await open(host)
    expect(markLeft(host)).toBe(grown.left)
    expect(text(host)).toContain(LINE)
    expect(isOff(button(host, 'Make 2 more takes')!)).toBe(false)
  })

  it('reads as before for a patch with no tie', async () => {
    const plain = await render([patchRow('a')], none, undefined, { areas: [bucket] })
    await open(plain.host)
    expect(text(plain.host)).toContain(HINT)
    expect(plain.host.querySelector('.patch-mark')).toBeNull()
  })

  it('says nothing of the area without a picture', async () => {
    const gone = await render(
      tied(),
      () => view([work('a')], { take: null, pictureGone: true }),
      undefined,
      {
        areas: [bucket],
      },
    )
    await open(gone.host)
    expect(text(gone.host)).not.toContain('Marked from')
    expect(text(gone.host)).not.toContain('has no place yet')
  })

  it('keeps the mark and the line, with Make off, while the model is missing', async () => {
    const { host } = await render(
      tied(),
      () => view([work('a')], { maker: { ok: false, message: 'No model.' } }),
      undefined,
      { areas: [bucket] },
    )
    await open(host)
    expect(markLeft(host)).toBe(grown.left)
    expect(text(host)).toContain(LINE)
    expect(isOff(button(host, 'Make 2 takes')!)).toBe(true)
  })

  it('steps the dashes aside, with the line and Make on, for a take that covers the same place', async () => {
    const same = { x: 76, y: 76, width: 248, height: 198 }
    const made = () => view([work('a', { takes: [takeOf(1, { area: same })] })])
    const { host } = await render(tied(), made, undefined, { areas: [bucket] })
    await open(host)
    expect(host.querySelector('.patch-mark')).toBeNull()
    expect(text(host)).toContain(LINE)
    expect(isOff(button(host, 'Make 2 more takes')!)).toBe(false)
  })

  it('stops the mark at the picture’s edge for an area on it', async () => {
    const edge = { ...bucket, box: { x: 0, y: 0, width: 100, height: 100 } }
    const { host, sent } = await render(tied(), none, undefined, { areas: [edge] })
    await open(host)
    await act(async () => button(host, 'Make 2 takes')!.click())
    expect(sent[0]!.body).toEqual({
      count: 2,
      area: { x: 0, y: 0, width: 124, height: 124 },
      model: 'klein',
    })
  })

  it('puts focus on the heading when Back is pressed with Make off', async () => {
    const { host } = await render(
      tied(),
      () => view([work('a')], { maker: { ok: false, message: 'No model.' } }),
      undefined,
      { areas: [bucket] },
    )
    await open(host)
    await drag(stageOf(host), [400, 300], [500, 380])
    await act(async () => button(host, 'Back to “Bucket”')!.click())
    await settle()
    expect(document.activeElement).toBe(host.querySelector('.patch-looking .lbl'))
  })
})

describe('what the game gets', () => {
  const one =
    (over: Partial<PatchWorkView> = {}, more: Partial<ImagePatchesView> = {}) =>
    () =>
      view([work('a', over), work('b')], more)
  const box = (host: Element, at = 0) =>
    [...host.querySelectorAll<HTMLInputElement>('.patch-takes input[type=checkbox]')][at]!
  const caption = (host: Element) =>
    text(host.querySelector('.patch-stage + .faint, .look-empty + .faint'))

  it('has a box in the Takes heading, ticked, also before any takes exist', async () => {
    const { host } = await render([patchRow('a')], one())
    await open(host)
    expect(text(box(host).closest('label'))).toBe('What the game gets')
    expect(box(host).checked).toBe(true)
    expect(text(host.querySelector('.patch-takes-head'))).toContain('Takes')
  })

  it('shows the game’s version at the game’s size when ticked and the model’s picture when not', async () => {
    const { host } = await render([patchRow('a')], one({ takes: [takeOf(1, { chosen: true })] }))
    await open(host)
    expect(host.querySelector('img.patch-take')!.getAttribute('src')).toStartWith(
      '/api/images/inn/takes/3/game?v=',
    )
    expect(host.querySelector('img.patch-over')!.getAttribute('src')).toStartWith(
      '/api/images/inn/patches/a/takes/1/game?v=',
    )
    expect(caption(host)).toBe('512 × 288')
    await act(async () => box(host).click())
    expect(host.querySelector('img.patch-take')!.getAttribute('src')).toBe(
      '/api/images/inn/takes/3',
    )
    expect(host.querySelector('img.patch-over')!.getAttribute('src')).toBe(
      '/api/images/inn/patches/a/takes/1',
    )
    expect(caption(host)).toBe('1024 × 576')
  })

  it('says the model’s picture is cropped to fit when it has another shape', async () => {
    const { host } = await render(
      [patchRow('a')],
      one(
        {},
        {
          take: { n: 3, width: 1024, height: 640, cropped: true },
          game: { width: 640, height: 400 },
        },
      ),
    )
    await open(host)
    await act(async () => box(host).click())
    expect(caption(host)).toBe('1024 × 640 · cropped to fit')
  })

  it('changes only the patch it sits in, and keeps its state when the row is closed and opened', async () => {
    const { host } = await render([patchRow('a'), patchRow('b')], one())
    await open(host, 0)
    await open(host, 1)
    await act(async () => box(host, 0).click())
    expect(box(host, 0).checked).toBe(false)
    expect(box(host, 1).checked).toBe(true)
    await open(host, 0)
    await open(host, 0)
    expect(box(host, 0).checked).toBe(false)
  })

  it('puts the mark on the same place of either version', async () => {
    const { host } = await render([patchRow('a')], one())
    await open(host)
    await drag(stageOf(host), [100, 50], [300, 250])
    const ticked = (host.querySelector('.patch-mark') as HTMLElement).style.left
    await act(async () => box(host).click())
    expect((host.querySelector('.patch-mark') as HTMLElement).style.left).toBe(ticked)
  })

  it('draws a mark reaching past the part the game shows on the edges of the game’s version', async () => {
    const { host } = await render(
      [patchRow('a')],
      one(
        {},
        {
          take: { n: 3, width: 1024, height: 576, cropped: true },
          game: { width: 640, height: 400 },
        },
      ),
    )
    await open(host)
    await drag(stageOf(host), [2, 2], [1022, 574])
    const mark = host.querySelector('.patch-mark') as HTMLElement
    expect(mark.style.left).toBe('0%')
    expect(mark.style.width).toBe('100%')
  })

  it('says a take is being brought, and turns Choose off, ticked or not', async () => {
    const { host } = await render(
      [patchRow('a')],
      one({ takes: [takeOf(1, { look: 'bringing' })] }),
    )
    await open(host)
    expect(text(host.querySelector('.look-empty'))).toBe("Bringing to the game's look…")
    expect(isOff(button(host, 'Choose')!)).toBe(true)
    await act(async () => box(host).click())
    expect(host.querySelector('.look-empty')).toBeNull()
    expect(isOff(button(host, 'Choose')!)).toBe(true)
  })

  it('says a take has not been brought', async () => {
    const { host } = await render([patchRow('a')], one({ takes: [takeOf(1, { look: 'missing' })] }))
    await open(host)
    expect(text(host.querySelector('.look-empty'))).toBe("Not brought to the game's look yet.")
  })

  it('says what to fix when the style cannot be read, and will not choose', async () => {
    const { host } = await render(
      [patchRow('a')],
      one({ takes: [takeOf(1)] }, { lookError: "Can't bring this take to the game's look: x." }),
    )
    await open(host)
    expect(text(host.querySelector('.look-empty-err'))).toBe(
      "Can't bring this take to the game's look: x.",
    )
    expect(text(host)).toContain('Fix the style to choose this take.')
    expect(isOff(button(host, 'Choose')!)).toBe(true)
    expect(isOff(button(host, 'Drop')!)).toBe(false)
  })

  it('turns Choose, Drop and Un-choose off while the lock cannot be read, and says why', async () => {
    const { host } = await render(
      [patchRow('a')],
      one({ takes: [takeOf(1), takeOf(2, { chosen: true })] }, { lockUnread: true }),
    )
    await open(host)
    expect(text(host)).toContain(
      'Choosing, dropping and un-choosing wait until the images lock can be read. You can still look and make more takes.',
    )
    await act(async () => thumbs(host)[0]!.click())
    expect(isOff(button(host, 'Choose')!)).toBe(true)
    expect(isOff(button(host, 'Drop')!)).toBe(true)
  })

  it('wears “Old look” on the closed row and above the picture of a chosen patch in an old look', async () => {
    const { host } = await render(
      [patchRow('a')],
      one({ takes: [takeOf(1, { chosen: true, look: 'old' })], oldLook: true }),
    )
    expect(text(rows(host)[0])).toContain('Take 1 chosen Old look')
    await open(host)
    expect(heading(host)).toBe('Looking at Take 1 FLUX.2 klein Chosen Old look')
  })
})

describe('Make pressed straight after typing the words (as-d3b)', () => {
  /** An open patch with an area marked, whose words saves wait until `release` is called. */
  async function typedAndLeft(answer: () => Response) {
    const { host, sent } = await render([patchRow('a')], () => view([work('a')]))
    await open(host)
    await drag(stageOf(host), [100, 50], [300, 250])
    const served = globalThis.fetch
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    globalThis.fetch = (async (path: string, init?: RequestInit) => {
      if (init?.method !== 'PATCH') return served(path, init)
      sent.push({ method: 'PATCH', path, body: JSON.parse(String(init.body)) })
      await held
      return answer()
    }) as unknown as typeof fetch
    const field = host.querySelector('textarea')!
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      set.call(field, 'snowy winter night')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // The press of the mouse leaves the field; the click comes before anything has rendered.
    await act(async () => {
      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      button(host, 'Make 2 takes')!.click()
    })
    await settle()
    return { host, sent, release }
  }
  const madeIn = (sent: { method: string; path: string }[]) =>
    sent.filter((s) => s.method === 'POST' && s.path.endsWith('/takes'))

  it('asks for the takes only once the words are saved', async () => {
    const { sent, release } = await typedAndLeft(() => Response.json({ ok: true }))
    expect(sent.map((s) => s.method)).toEqual(['PATCH'])
    await act(async () => release())
    await settle()
    expect(sent.map((s) => s.method)).toEqual(['PATCH', 'POST'])
    expect(madeIn(sent)).toHaveLength(1)
  })

  it('keeps Make off while it waits, so a second press asks for nothing more', async () => {
    const { host, sent, release } = await typedAndLeft(() => Response.json({ ok: true }))
    expect(isOff(button(host, 'Make 2 takes')!)).toBe(true)
    await act(async () => button(host, 'Make 2 takes')!.click())
    await act(async () => release())
    await settle()
    expect(madeIn(sent)).toHaveLength(1)
  })

  it('makes nothing when the words could not be saved, and says why', async () => {
    const { host, sent, release } = await typedAndLeft(() =>
      Response.json({
        ok: false,
        problems: [{ file: 'edits.json', path: 'words', message: 'Too long' }],
      }),
    )
    await act(async () => release())
    await settle()
    expect(madeIn(sent)).toEqual([])
    expect(text(host)).toContain('Too long')
    expect(isOff(button(host, 'Make 2 takes')!)).toBe(false)
  })

  it('tries the words again on the next press, and makes takes only once they are saved', async () => {
    const answers = [false, false, true]
    const { host, sent, release } = await typedAndLeft(() => {
      const ok = answers.shift()!
      return Response.json(
        ok
          ? { ok }
          : { ok, problems: [{ file: 'edits.json', path: 'words', message: 'Too long' }] },
      )
    })
    await act(async () => release())
    await settle()
    expect(sent.map((s) => s.method)).toEqual(['PATCH'])
    // Focus has moved off the field, so this press leaves nothing and only Make can save the words.
    await act(async () => button(host, 'Make 2 takes')!.click())
    await settle()
    expect(sent.map((s) => s.method)).toEqual(['PATCH', 'PATCH'])
    expect(text(host)).toContain('Too long')
    await act(async () => button(host, 'Make 2 takes')!.click())
    await settle()
    expect(sent.map((s) => s.method)).toEqual(['PATCH', 'PATCH', 'PATCH', 'POST'])
    expect(sent[2]!.body).toEqual({ words: 'snowy winter night' })
  })

  it('makes nothing when the save itself failed', async () => {
    const { host, sent, release } = await typedAndLeft(() => new Response('', { status: 500 }))
    await act(async () => release())
    await settle()
    expect(madeIn(sent)).toEqual([])
    expect(isOff(button(host, 'Make 2 takes')!)).toBe(false)
  })
})

describe('the model of new takes', () => {
  const MODEL = 'select[aria-label="Model for new takes"]'
  const COUNT = 'select[aria-label="Number of new takes"]'
  const both = { 'qwen-edit': 'whole', klein: 'whole' } as const
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
  const menuOf = (host: Element, at = 0) =>
    host.querySelectorAll<HTMLSelectElement>(MODEL)[at] as HTMLSelectElement
  const pick = (menu: HTMLSelectElement, value: string) =>
    act(async () => {
      set.call(menu, value)
      menu.dispatchEvent(new Event('change', { bubbles: true }))
    })
  const withModels = (
    patches: PatchWorkView[],
    models: ImagePatchesView['models'] = both,
    over: Partial<ImagePatchesView> = {},
  ) => view(patches, { models, ...over })

  it('has one menu above the count, offering the two models, on klein', async () => {
    const { host } = await render([patchRow('a')], () => withModels([work('a')]))
    await open(host)
    const menu = menuOf(host)
    expect([...menu.options].map((o) => o.textContent)).toEqual([
      'FLUX.2 klein 4B — a guess: about 20 s a take',
      'Qwen Image Edit — a guess: about 8 min a take',
    ])
    expect(menu.value).toBe('klein')
    // Closed, a face that can wrap shows the chosen entry's short form.
    expect(menu.closest('.menu-face')!.firstElementChild!.textContent).toBe(
      'FLUX.2 klein — a guess: about 20 s a take',
    )
    expect(menu.options[0]!.hasAttribute('label')).toBe(false)
    const count = host.querySelector(COUNT)!
    expect(menu.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // On a line of its own: not inside the row of the count, Make and Stop.
    expect(menu.closest('.patch-make')).toBeNull()
  })

  it('makes the takes with the model it is on', async () => {
    const { host, sent } = await render([patchRow('a')], () => withModels([work('a')]))
    await open(host)
    await drag(stageOf(host), [100, 50], [300, 250])
    await act(async () => button(host, 'Make 2 takes')!.click())
    await pick(menuOf(host), 'qwen-edit')
    await act(async () => button(host, 'Make 2 takes')!.click())
    expect(sent.map((s) => (s.body as { model: string }).model)).toEqual(['klein', 'qwen-edit'])
  })

  it('keeps one pick per patch, across closing and opening its row', async () => {
    const { host } = await render([patchRow('a'), patchRow('b')], () =>
      withModels([work('a'), work('b')]),
    )
    await open(host, 0)
    await pick(menuOf(host), 'qwen-edit')
    await open(host, 1)
    expect(menuOf(host, 0).value).toBe('qwen-edit')
    expect(menuOf(host, 1).value).toBe('klein')
    await open(host, 0)
    expect(host.querySelectorAll(MODEL)).toHaveLength(1)
    await open(host, 0)
    expect(menuOf(host, 0).value).toBe('qwen-edit')
  })

  it('starts on Qwen when klein is not here and Qwen is', async () => {
    const { host } = await render([patchRow('a')], () =>
      withModels([work('a')], { 'qwen-edit': 'whole', klein: 'absent' }),
    )
    await open(host)
    await drag(stageOf(host), [100, 50], [300, 250])
    expect(menuOf(host).value).toBe('qwen-edit')
    expect(isOff(button(host, 'Make 2 takes')!)).toBe(false)
  })

  for (const qwen of ['absent', 'partial'] as const) {
    it(`starts on klein with no line about Qwen when Qwen is ${qwen}`, async () => {
      const { host } = await render([patchRow('a')], () =>
        withModels([work('a')], { 'qwen-edit': qwen, klein: 'whole' }),
      )
      await open(host)
      await drag(stageOf(host), [100, 50], [300, 250])
      expect(menuOf(host).value).toBe('klein')
      expect(text(host)).not.toContain('so these takes use')
      expect(text(host)).not.toContain('Setup says how')
      expect(isOff(button(host, 'Make 2 takes')!)).toBe(false)
    })
  }

  it('says a picked model is not on this computer, turns Make off and points to Setup', async () => {
    const { host, sent } = await render([patchRow('a')], () =>
      withModels([work('a')], { 'qwen-edit': 'absent', klein: 'whole' }),
    )
    await open(host)
    await drag(stageOf(host), [100, 50], [300, 250])
    await pick(menuOf(host), 'qwen-edit')
    expect(text(menuOf(host).closest('.edit-model'))).toContain('not on this computer')
    expect(text(host)).toContain('Setup says how to download it.')
    expect(text(host)).not.toContain('so these takes use FLUX.2 klein')
    expect(isOff(button(host, 'Make 2 takes')!)).toBe(true)
    expect(sent).toEqual([])
  })

  it('says a download is incomplete', async () => {
    const { host } = await render([patchRow('a')], () =>
      withModels([work('a')], { 'qwen-edit': 'partial', klein: 'whole' }),
    )
    await open(host)
    await pick(menuOf(host), 'qwen-edit')
    expect(text(menuOf(host).closest('.edit-model'))).toContain('download incomplete')
  })

  it('warns that the last take failed, under the menu and in the open list', async () => {
    const { host } = await render([patchRow('a')], () =>
      withModels([work('a', { failedModels: ['qwen-edit'] })]),
    )
    await open(host)
    expect(text(menuOf(host).closest('.edit-model'))).toContain('last take failed')
    expect(menuOf(host).options[0]!.textContent).toBe(
      'FLUX.2 klein 4B — a guess: about 20 s a take',
    )
    expect(menuOf(host).options[1]!.textContent).toBe(
      'Qwen Image Edit — a guess: about 8 min a take — last take failed',
    )
  })

  it('turns the menu, count and Make off while takes are made, and names the model of each', async () => {
    const { host } = await render([patchRow('a'), patchRow('b')], () =>
      withModels([
        work('a', {
          takes: [takeOf(1)],
          making: [
            { n: 2, state: 'making', elapsed: 60, expected: 360, area, model: 'qwen-edit' },
            { n: 3, state: 'waiting', elapsed: 0, expected: 360, area, model: 'qwen-edit' },
          ],
        }),
        work('b'),
      ]),
    )
    await open(host, 0)
    await open(host, 1)
    expect(isOff(menuOf(host, 0))).toBe(true)
    expect(menuOf(host, 0).dataset.why).toBe(
      'Takes are being made for this patch. Change this when they are done, or Stop.',
    )
    expect(isOff(menuOf(host, 1))).toBe(false)
    expect(menuOf(host, 1).dataset.why).toBeUndefined()
    const making = host.querySelectorAll('.patch-thumb-making')
    expect(text(making[0])).toContain('Take 2 Qwen Image Edit making · about 5 min left')
    expect(text(making[1])).toContain('Take 3 Qwen Image Edit waiting')
    expect(button(host, 'Stop')).not.toBeUndefined()
  })

  it('names the model under each take and beside Looking at; an old take reads FLUX.2 klein', async () => {
    const { host } = await render([patchRow('a')], () =>
      withModels([
        work('a', { takes: [takeOf(1), takeOf(2, { model: 'qwen-edit', chosen: true })] }),
      ]),
    )
    await open(host)
    const [first, second] = thumbs(host)
    expect(text(first)).toBe('Take 1 FLUX.2 klein')
    expect(text(second)).toContain('Take 2 Chosen Qwen Image Edit')
    expect(heading(host)).toContain('Take 2')
    expect(heading(host)).toContain('Qwen Image Edit')
    // Pressing a take lays it over the picture and leaves the menu alone.
    await act(async () => first!.click())
    expect(heading(host)).toContain('FLUX.2 klein')
    await act(async () => second!.click())
    expect(heading(host)).toContain('Qwen Image Edit')
    expect(menuOf(host).value).toBe('klein')
  })

  it('makes a failed take again with the model that failed, and is off when it is no longer here', async () => {
    const failed = [{ n: 4, message: 'out of memory.', area, model: 'qwen-edit' as const }]
    const here = await render([patchRow('a')], () => withModels([work('a', { failed })]))
    await open(here.host)
    // The menu is on klein; Try again still uses the model that failed.
    expect(menuOf(here.host).value).toBe('klein')
    await act(async () => button(here.host, 'Try again')!.click())
    expect(here.sent).toEqual([
      { method: 'POST', path: '/api/images/inn/patches/a/takes', body: { retry: 4 } },
    ])
    const gone = await render([patchRow('a')], () =>
      withModels([work('a', { failed })], { 'qwen-edit': 'absent', klein: 'whole' }),
    )
    await open(gone.host)
    expect(isOff(button(gone.host, 'Try again')!)).toBe(true)
  })

  it('does not hear the patch keys typed in the menu', async () => {
    const { host, sent } = await render([patchRow('a')], () =>
      withModels([work('a', { takes: [takeOf(1), takeOf(2)] })]),
    )
    await open(host)
    await key(menuOf(host), 'c')
    await key(menuOf(host), 'ArrowLeft')
    expect(sent).toEqual([])
  })

  it('leaves the Remake menu on klein whatever a patch is picked on', async () => {
    const { host } = await render([patchRow('a', { chosenOn: [3] })], () =>
      withModels([work('a')], both, {
        remake: { earlier: { a: area }, press: null, failedModels: [] },
      }),
    )
    await open(host)
    await pick(menuOf(host), 'qwen-edit')
    const remake = host.querySelector<HTMLSelectElement>(
      'select[aria-label="Model for the new takes of each patch"]',
    )!
    expect(remake.value).toBe('klein')
    await pick(remake, 'qwen-edit')
    expect(menuOf(host).value).toBe('qwen-edit')
    await pick(menuOf(host), 'klein')
    expect(remake.value).toBe('qwen-edit')
  })

  it('has no menu with no chosen take of the image', async () => {
    const { host } = await render([patchRow('a')], () =>
      withModels([work('a')], both, { take: null }),
    )
    await open(host)
    expect(host.querySelector(MODEL)).toBeNull()
  })
})
