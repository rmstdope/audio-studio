import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ImagePatchesView, PatchWorkView } from '../../../core/imagePatches'
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

const patchRow = (id: string, over: Partial<PatchRow> = {}): PatchRow => ({
  id,
  title: `Title of ${id}`,
  description: `Game words of ${id}`,
  words: `Game words of ${id}`,
  changed: false,
  gameChanged: false,
  gameWas: null,
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
  ...over,
})

const work = (id: string, over: Partial<PatchWorkView> = {}): PatchWorkView => ({
  id,
  takes: [],
  making: [],
  failed: [],
  ...over,
})

const view = (
  patches: PatchWorkView[],
  over: Partial<ImagePatchesView> = {},
): ImagePatchesView => ({
  ok: true,
  take: { n: 3, width: 1024, height: 576 },
  pictureGone: false,
  maker: { ok: true },
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
        createElement(GamePatchesPanel, { row: { id: 'inn', patches } as ImageRow }),
      ),
    )
  })
  await settle()
  cleanups.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  return { host, sent }
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
    expect(base.getAttribute('src')).toBe('/api/images/inn/takes/3')
    expect(host.querySelector('img.patch-over')).toBeNull()
    expect(text(host)).toContain('Drag over the picture to mark what should change.')
    expect(button(host, 'Make 2 takes')!.disabled).toBe(true)
    expect(text(host)).toContain(
      'No takes yet. Each take is a new try at this change, painted with the whole picture in view.',
    )
    expect(text(host)).toContain('Takes')
    expect(text(host)).not.toContain('Takes ·')
  })

  it('draws the dashes when an area is marked, turns Make on and drops the hint', async () => {
    const { host } = await render([patchRow('a')], none)
    await open(host)
    await drag(stageOf(host), [100, 50], [300, 250])
    expect(host.querySelector('.patch-mark')).not.toBeNull()
    expect(button(host, 'Make 2 takes')!.disabled).toBe(false)
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
    expect(sent[0]!.body).toEqual({ count: 2, area: { x: 900, y: 500, width: 124, height: 76 } })
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
      { method: 'POST', path: '/api/images/inn/patches/a/takes', body: { count: 3, area } },
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
    expect(button(host, 'Make 2 takes')!.disabled).toBe(true)
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
    expect(heading(host)).toBe('Looking at Take 2 Chosen')
    expect(host.querySelector('img.patch-over')!.getAttribute('src')).toBe(
      '/api/images/inn/patches/a/takes/2',
    )
    const none = await render([patchRow('a')], () =>
      view([work('a', { takes: [takeOf(1), takeOf(2)] })]),
    )
    await open(none.host)
    expect(heading(none.host)).toBe('Looking at Take 2')
  })

  it('heads the takes with their count and explains how to look at one', async () => {
    const { host } = await render([patchRow('a')], made())
    await open(host)
    expect(text(host)).toContain('Takes · 3')
    expect(text(host)).toContain('Press a take, or use ← →, to lay it over the picture.')
    expect(thumbs(host).map((t) => text(t))).toEqual(['Take 1', 'Take 2 Chosen', 'Take 3'])
    expect(text(host)).not.toContain('No takes yet.')
  })

  it('lays a pressed take over the picture, makes its area the mark and hides the dashes when they agree', async () => {
    const { host } = await render([patchRow('a')], made())
    await open(host)
    await act(async () => thumbs(host)[2]!.click())
    expect(heading(host)).toBe('Looking at Take 3')
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
    expect(heading(host)).toBe('Looking at Take 1')
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
      'Take 1 earlier words',
      'Take 2 new',
      'Take 3',
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
    expect(heading(host)).toBe('Looking at Take 2')
    await act(async () => thumbs(host)[0]!.click())
    takes = [...takes, takeOf(3, { isNew: true })]
    // The page asks for the patches again when it makes or changes something.
    await act(async () => button(host, 'Drop')!.click())
    await settle()
    expect(heading(host)).toBe('Looking at Take 2')
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
    expect(heading(host)).toBe('Looking at Take 3')
    await key(focus, 'ArrowRight')
    expect(heading(host)).toBe('Looking at Take 3')
    await key(focus, 'ArrowLeft')
    await key(focus, 'ArrowLeft')
    await key(focus, 'ArrowLeft')
    expect(heading(host)).toBe('Looking at Take 1')
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
    expect(heading(host)).toBe('Looking at Take 2 Chosen')
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
  })
})

describe('takes being made and failed', () => {
  it('shows a take waiting, with the Stop button, and turns Make off', async () => {
    const { host, sent } = await render([patchRow('a')], () =>
      view([
        work('a', {
          takes: [takeOf(1)],
          making: [
            { n: 2, state: 'waiting', elapsed: 0, expected: 15, area },
            { n: 3, state: 'making', elapsed: 5, expected: 15, area },
          ],
        }),
      ]),
    )
    await open(host)
    expect(text(host)).toContain('Takes · 1')
    const waiting = host.querySelectorAll('.patch-thumb-making')
    expect([...waiting].map((w) => text(w).replace(/ making.*$/, ''))).toEqual([
      'Take 2 waiting',
      'Take 3',
    ])
    expect(host.querySelectorAll('[role="progressbar"]').length).toBe(2)
    expect(button(host, 'Make 2 more takes')!.disabled).toBe(true)
    await act(async () => button(host, 'Stop')!.click())
    expect(sent.map((s) => [s.method, s.path])).toEqual([
      ['POST', '/api/images/inn/patches/a/stop'],
    ])
  })

  it('shows a take that could not be made, with the others kept, and tries it again', async () => {
    const { host, sent } = await render([patchRow('a')], () =>
      view([
        work('a', {
          takes: [takeOf(1)],
          failed: [{ n: 4, message: 'The image generator ran out of memory.', area }],
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
      view([work('a', { failed: [{ n: 1, message: 'Out of memory.', area }] })]),
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
