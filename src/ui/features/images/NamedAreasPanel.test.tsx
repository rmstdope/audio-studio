import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { AreaBox, AreaRow, ImageRow } from '../../../core/images'
import type { ImagePatchesView } from '../../../core/imagePatches'
import { valuesInEveryWindow } from '../../../../test/stylesheet'
// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register({ url: 'http://localhost/' })
const isOff = (element: Element) => element.getAttribute('aria-disabled') === 'true'
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { NamedAreasPanel } = await import('./NamedAreasPanel')
const { JobOpenProvider } = await import('./ImageJobTabs')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
const realFetch = globalThis.fetch
afterEach(() => {
  cleanups.splice(0).forEach((c) => c())
  globalThis.fetch = realFetch
})
afterAll(() => GlobalRegistrator.unregister())

const area = (id: string, over: Partial<AreaRow> = {}): AreaRow => ({
  id,
  title: `Title of ${id}`,
  placed: false,
  box: null,
  boxes: {},
  elsewhere: [],
  elsewhereGone: false,
  ...over,
})
const placedAt = (id: string, box: AreaBox, over: Partial<AreaRow> = {}) =>
  area(id, { placed: true, box, ...over })

const view = (over: Partial<ImagePatchesView> = {}): ImagePatchesView => ({
  ok: true,
  take: { n: 2, width: 1024, height: 640, cropped: false },
  game: { width: 640, height: 400 },
  lookError: null,
  lookKey: 'k',
  lockUnread: false,
  pictureGone: false,
  remake: { earlier: {}, press: null, failedModels: [] },
  maker: { ok: true },
  models: { 'qwen-edit': 'whole', klein: 'whole' },
  patches: [],
  ...over,
})

/** A patch of the image as the row titles it and the patches query lists its takes. */
interface ListedPatch {
  id: string
  title: string
  takes: { n: number; chosen: boolean }[]
}

/** A patch's view, its takes with every field the page reads. */
const patchView = (patch: ListedPatch): ImagePatchesView['patches'][number] => ({
  id: patch.id,
  takes: patch.takes.map(({ n, chosen }) => ({
    n,
    chosen,
    area: { x: 0, y: 0, width: 10, height: 10 },
    earlier: false,
    isNew: false,
    look: 'ready' as const,
    model: 'klein' as const,
    kept: null,
  })),
  making: [],
  failed: [],
  oldLook: false,
  failedModels: [],
})

interface Options {
  answer?: ImagePatchesView | (() => Promise<Response>)
  saved?: { status: number; body: unknown }
  /** Patches the game lists on the image, with their takes on its chosen take. */
  patches?: ListedPatch[]
  chosenTake?: number | null
  /** Whether the panel's tab is the open one (default true). */
  open?: boolean
  /** The image's size (default 320 x 200). */
  size?: { width: number; height: number }
}

/** Renders the panel for an image of 320 x 200 with these areas; gives what was saved. */
async function render(areas: AreaRow[], options: Options = {}) {
  // Chosen patches reach the panel as the page gives them: titles in the row, takes in the query.
  const chosenViews = (options.patches ?? []).map(patchView)
  const puts: { path: string; body: { box: AreaBox | null } }[] = []
  const saved = options.saved ?? { status: 200, body: { ok: true } }
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      puts.push({ path: url, body: JSON.parse(String(init.body)) })
      return Response.json(saved.body, { status: saved.status })
    }
    if (typeof options.answer === 'function') return options.answer()
    return Response.json(options.answer ?? view({ patches: chosenViews }))
  }) as typeof fetch
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let open = options.open ?? true
  const draw = async (now: AreaRow[], chosenTake: number | null) => {
    const row = {
      id: 'inn',
      width: options.size?.width ?? 320,
      height: options.size?.height ?? 200,
      areas: now,
      chosenTake,
      patches: (options.patches ?? []).map((p) => ({ id: p.id, title: p.title })),
    } as ImageRow
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(JobOpenProvider, { value: open }, createElement(NamedAreasPanel, { row })),
        ),
      )
    })
  }
  await draw(areas, options.chosenTake ?? null)
  await settle()
  cleanups.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  const stage = host.querySelector<HTMLElement>('.named-area-stage')
  if (stage) {
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 200 }) as DOMRect
  }
  const setOpen = async (now: boolean) => {
    open = now
    await draw(areas, options.chosenTake ?? null)
  }
  return { host, puts, stage, draw, setOpen }
}

/** Lets pending requests, state updates and animation frames run. */
async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => await new Promise((r) => setTimeout(r, 5)))
}

/** Sends a pointer event of `type` at this picture point (one screen pixel per image pixel). */
async function pointer(target: Element, type: string, x: number, y: number) {
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 }),
    )
  })
}

/** A drag over the picture from one point to another. */
async function drag(
  stage: Element,
  from: [number, number],
  to: [number, number],
  on: Element = stage,
) {
  await pointer(on, 'pointerdown', ...from)
  await pointer(stage, 'pointermove', ...to)
  await pointer(stage, 'pointerup', ...to)
  await settle()
}

async function press(target: Element, key: string, shiftKey = false, altKey = false) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, altKey, bubbles: true }))
  })
  await settle()
}

const text = (e: Element) => e.textContent ?? ''
const rows = (host: HTMLElement) => [...host.querySelectorAll('.named-area')]
const mainOf = (host: HTMLElement, at: number) =>
  rows(host)[at]!.querySelector<HTMLButtonElement>('.named-area-main')!
const selectedIds = (host: HTMLElement) =>
  rows(host).flatMap((r, at) => (r.classList.contains('selected') ? [at] : []))
const line = (host: HTMLElement) => host.querySelector('.named-area-line')?.textContent
const boxes = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.named-area-box')]
const tagOf = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-area="${id}"]`)!

describe('the named areas panel', () => {
  it('shows nothing when the game names no area', async () => {
    expect((await render([])).host.innerHTML).toBe('')
  })

  it('opens with its heading, the count and the line, then a row per area in order', async () => {
    const { host } = await render([area('b'), area('a')])
    expect(host.querySelector('h2')!.textContent).toBe('Named areas')
    expect(host.querySelector('.named-areas-head')!.textContent).toBe('Named areas · 0 of 2 placed')
    expect(host.querySelector('.named-areas-intro')).toBeNull()
    expect(rows(host).map((r) => r.querySelector('b')!.textContent)).toEqual([
      'Title of b',
      'Title of a',
    ])
    expect(mainOf(host, 0).title).toBe('b')
  })

  it('marks an area placed or to place, and counts the placed ones', async () => {
    const box = { x: 10, y: 10, width: 20, height: 20 }
    const { host } = await render([placedAt('a', box), area('b'), area('c')])
    expect(rows(host).map((r) => r.querySelector('.chip')!.textContent)).toEqual([
      'Placed',
      'To place',
      'To place',
    ])
    expect(rows(host)[0]!.querySelector('.chip-ok')).not.toBeNull()
    expect(rows(host)[1]!.querySelector('.chip-attention')).not.toBeNull()
    expect(host.querySelector('.named-areas-head')!.textContent).toContain('1 of 3 placed')
  })

  it('shows two areas with one title, told apart by their ids', async () => {
    const { host } = await render([area('a', { title: 'Door' }), area('b', { title: 'Door' })])
    expect(rows(host).map((r) => r.querySelector('button')!.title)).toEqual(['a', 'b'])
  })

  describe('arriving', () => {
    it('selects the first area still to place and says what to do', async () => {
      const box = { x: 10, y: 10, width: 20, height: 20 }
      const { host } = await render([
        placedAt('a', box),
        area('b', { title: 'Old notice' }),
        area('c'),
      ])
      expect(selectedIds(host)).toEqual([1])
      expect(line(host)).toBe('Take 2 · drag on the picture to place “Old notice”')
      expect(host.querySelector('.named-area-clear')).toBeNull()
    })

    it('selects nothing when every area is placed, and says how to change one', async () => {
      const box = { x: 10, y: 10, width: 20, height: 20 }
      const { host } = await render([placedAt('a', box), placedAt('b', box)])
      expect(selectedIds(host)).toEqual([])
      expect(line(host)).toBe('Take 2 · press an area in the list or on the picture to change it.')
    })

    it('shows the chosen take’s picture in the shape of the image', async () => {
      const { host, stage } = await render([area('a')])
      expect(host.querySelector<HTMLImageElement>('img.named-area-take')!.src).toContain(
        '/api/images/inn/takes/2',
      )
      expect(stage!.style.aspectRatio).toBe('320 / 200')
    })
  })

  describe('without a picture to mark on', () => {
    it('says to choose a take, and selects and lines nothing', async () => {
      const { host } = await render([area('a')], { answer: view({ take: null }) })
      expect(host.querySelector('.named-area-empty')!.textContent).toBe(
        'Choose a take to mark the areas on it.',
      )
      expect(host.querySelector('.named-area-line')).toBeNull()
      expect(selectedIds(host)).toEqual([])
      expect(isOff(mainOf(host, 0))).toBe(true)
      expect(host.querySelector('.named-areas-head')!.textContent).toContain('0 of 1 placed')
    })

    it('says which take is not known while the lock cannot be read, on the panel and the rows', async () => {
      const line =
        'Which take the game shows is not known until the images lock can be read; fix it, then reload.'
      const { host } = await render([area('a')], {
        answer: view({ take: null, lockUnread: true }),
      })
      expect(host.querySelector('.named-area-empty')!.textContent).toBe(line)
      expect(mainOf(host, 0).getAttribute('data-why')).toBe(line)
      expect(isOff(mainOf(host, 0))).toBe(true)
      expect(host.querySelector('.named-area-switches')).toBeNull()
    })

    it('says the picture is missing, and keeps the boxes already placed in the list', async () => {
      const box = { x: 10, y: 10, width: 20, height: 20 }
      const { host } = await render([placedAt('a', box)], {
        answer: view({ take: null, pictureGone: true }),
      })
      expect(host.querySelector('.named-area-empty')!.textContent).toBe(
        "The chosen take's picture is missing or cannot be read, so the areas cannot be marked on it.",
      )
      expect(rows(host)[0]!.querySelector('.chip')!.textContent).toBe('Placed')
      expect(isOff(mainOf(host, 0))).toBe(true)
    })

    it('says so too when the picture cannot be read once asked for', async () => {
      const { host } = await render([area('a')])
      await act(async () => {
        host.querySelector('img.named-area-take')!.dispatchEvent(new Event('error'))
      })
      expect(host.querySelector('.named-area-empty')!.textContent).toContain('missing or cannot')
      expect(selectedIds(host)).toEqual([])
    })

    it('says so when the pictures cannot be asked for at all', async () => {
      const { host } = await render([area('a')], {
        answer: () =>
          Promise.resolve(
            Response.json({
              ok: false,
              file: 'f',
              problems: [{ file: 'f', path: '', message: 'x' }],
            }),
          ),
      })
      expect(host.querySelector('.named-area-empty')!.textContent).toContain('missing or cannot')
    })

    it('keeps the picture’s place empty while it loads, with the list as usual', async () => {
      const { host } = await render([area('a')], { answer: () => new Promise<Response>(() => {}) })
      expect(host.querySelector('.named-area-empty')!.textContent).toBe('')
      expect(host.querySelector<HTMLElement>('.named-area-empty')!.style.aspectRatio).toBe(
        '320 / 200',
      )
      expect(host.querySelector('.named-area-line')).toBeNull()
      expect(rows(host).length).toBe(1)
    })
  })

  describe('selecting', () => {
    it('selects the row pressed, and says to mark it or change it', async () => {
      const box = { x: 10, y: 10, width: 20, height: 20 }
      const { host } = await render([area('a'), placedAt('b', box, { title: 'Well' })])
      await act(async () => mainOf(host, 1).click())
      expect(selectedIds(host)).toEqual([1])
      expect(line(host)).toContain('Take 2 · drag the box to move it')
      expect(host.querySelector('.named-area-clear')!.textContent).toBe('Clear')
      await act(async () => mainOf(host, 0).click())
      expect(selectedIds(host)).toEqual([0])
      expect(host.querySelector('.named-area-clear')).toBeNull()
    })

    it('selects a placed box by clicking it, the smallest where they overlap', async () => {
      const { host, stage } = await render([
        placedAt('big', { x: 0, y: 0, width: 200, height: 100 }),
        placedAt('small', { x: 10, y: 10, width: 20, height: 20 }),
      ])
      await drag(stage!, [100, 50], [100, 50])
      expect(selectedIds(host)).toEqual([0])
      await drag(stage!, [15, 15], [15, 15])
      expect(selectedIds(host)).toEqual([1])
    })

    it('selects a box clicked inside the selected one, even without moving it', async () => {
      const { host, stage } = await render([
        placedAt('big', { x: 0, y: 0, width: 200, height: 100 }),
        placedAt('small', { x: 10, y: 10, width: 20, height: 20 }),
      ])
      await act(async () => mainOf(host, 0).click())
      await drag(stage!, [15, 15], [15, 15])
      expect(selectedIds(host)).toEqual([1])
      expect(host.querySelectorAll('.handle').length).toBe(8)
    })

    it('draws the selected box on top with eight handles, the others without', async () => {
      const { host } = await render([
        placedAt('a', { x: 0, y: 0, width: 50, height: 50 }),
        placedAt('b', { x: 100, y: 0, width: 50, height: 50 }),
      ])
      await act(async () => mainOf(host, 0).click())
      expect(boxes(host).at(-1)!.dataset.area).toBe('a')
      expect(tagOf(host, 'a').querySelectorAll('.handle').length).toBe(8)
      expect(tagOf(host, 'b').querySelectorAll('.handle').length).toBe(0)
    })
  })

  describe('drawing', () => {
    it('draws the selected area’s box and saves it as the mouse lets go, staying selected', async () => {
      const { host, stage, puts } = await render([area('a'), area('b')])
      await drag(stage!, [20, 30], [120, 90])
      expect(puts).toEqual([
        {
          path: '/api/images/inn/areas/a',
          body: { box: { x: 20, y: 30, width: 100, height: 60 } },
        },
      ])
      expect(rows(host)[0]!.querySelector('.chip')!.textContent).toBe('Placed')
      expect(host.querySelector('.named-areas-head')!.textContent).toContain('1 of 2 placed')
      expect(selectedIds(host)).toEqual([0])
      expect(host.querySelectorAll('.handle').length).toBe(8)
      expect(document.activeElement).toBe(mainOf(host, 0))
      expect(host.querySelector('button.save, .btn-primary')).toBeNull()
    })

    it('stops at the picture’s edges', async () => {
      const { stage, puts } = await render([area('a')])
      await drag(stage!, [300, 180], [900, 900])
      expect(puts[0]!.body.box).toEqual({ x: 300, y: 180, width: 20, height: 20 })
    })

    it('shows a dashed box while dragging', async () => {
      const { host, stage } = await render([area('a')])
      await pointer(stage!, 'pointerdown', 10, 10)
      await pointer(stage!, 'pointermove', 80, 60)
      expect(host.querySelector('.named-area-box.drawing')).not.toBeNull()
      await pointer(stage!, 'pointerup', 80, 60)
    })

    it('draws nothing for a drag too small to be a box', async () => {
      const { host, stage, puts } = await render([area('a')])
      await drag(stage!, [50, 50], [52, 90])
      expect(puts).toEqual([])
      expect(host.querySelector('.named-area-box')).toBeNull()
    })

    it('starts a drawing on another area’s box as a drawing of the selected one', async () => {
      const { stage, puts } = await render([
        area('a'),
        placedAt('b', { x: 100, y: 100, width: 100, height: 60 }),
      ])
      await drag(stage!, [110, 110], [150, 150])
      expect(puts[0]!.path).toBe('/api/images/inn/areas/a')
    })

    it('keeps the old box until let go, and then replaces it', async () => {
      const old = { x: 10, y: 10, width: 40, height: 40 }
      const { host, stage, puts } = await render([placedAt('a', old)])
      await act(async () => mainOf(host, 0).click())
      await pointer(stage!, 'pointerdown', 200, 100)
      await pointer(stage!, 'pointermove', 260, 150)
      expect(tagOf(host, 'a').style.left).toBe(`${(10 / 320) * 100}%`)
      await pointer(stage!, 'pointerup', 260, 150)
      await settle()
      expect(puts[0]!.body.box).toEqual({ x: 200, y: 100, width: 60, height: 50 })
      expect(tagOf(host, 'a').style.left).toBe(`${(200 / 320) * 100}%`)
    })

    it('cancels with Esc, leaving everything as it was', async () => {
      const { host, stage, puts } = await render([area('a')])
      await pointer(stage!, 'pointerdown', 10, 10)
      await pointer(stage!, 'pointermove', 80, 60)
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      })
      await pointer(stage!, 'pointerup', 80, 60)
      await settle()
      expect(puts).toEqual([])
      expect(host.querySelector('.named-area-box')).toBeNull()
      expect(selectedIds(host)).toEqual([0])
    })

    it('does nothing when no area is selected and the drag starts on nothing', async () => {
      const { stage, puts } = await render([placedAt('a', { x: 10, y: 10, width: 20, height: 20 })])
      await drag(stage!, [100, 100], [200, 150])
      expect(puts).toEqual([])
    })
  })

  describe('moving and resizing', () => {
    const start = { x: 100, y: 50, width: 60, height: 40 }
    const setup = async () => {
      const made = await render([placedAt('a', start)])
      await act(async () => mainOf(made.host, 0).click())
      return made
    }

    it('moves the box by a drag that starts inside it', async () => {
      const { stage, puts } = await setup()
      await drag(stage!, [120, 60], [140, 70])
      expect(puts[0]!.body.box).toEqual({ ...start, x: 120, y: 60 })
    })

    it('resizes it by a drag on a handle', async () => {
      const { host, stage, puts } = await setup()
      await drag(stage!, [160, 90], [200, 120], host.querySelector('.handle-se')!)
      expect(puts[0]!.body.box).toEqual({ x: 100, y: 50, width: 100, height: 70 })
    })

    it('resizes by a side handle and keeps the smallest size', async () => {
      const { host, stage, puts } = await setup()
      await drag(stage!, [100, 70], [300, 70], host.querySelector('.handle-w')!)
      expect(puts[0]!.body.box).toEqual({ x: 156, y: 50, width: 4, height: 40 })
    })

    it('counts a press that wobbles a screen pixel as a click, not a move', async () => {
      const { host, stage, puts } = await render([
        placedAt('a', start),
        placedAt('b', { x: 110, y: 60, width: 10, height: 10 }),
      ])
      await act(async () => mainOf(host, 0).click())
      await drag(stage!, [112, 62], [113, 62])
      expect(puts).toEqual([])
      expect(selectedIds(host)).toEqual([1])
    })

    it('counts a small wobble outside the box as a click on a box there', async () => {
      const { host, stage, puts } = await render([
        area('a'),
        placedAt('b', { x: 200, y: 100, width: 80, height: 50 }),
      ])
      await drag(stage!, [210, 110], [212, 112])
      expect(puts).toEqual([])
      expect(selectedIds(host)).toEqual([1])
    })

    it('saves nothing for a press on the box without moving', async () => {
      const { stage, puts } = await setup()
      await drag(stage!, [120, 60], [120, 60])
      expect(puts).toEqual([])
    })
  })

  describe('clearing', () => {
    const box = { x: 100, y: 50, width: 60, height: 40 }

    it('clears at once from the row’s button, leaving the area selected and to place', async () => {
      const { host, puts } = await render([placedAt('a', box)])
      await act(async () => mainOf(host, 0).click())
      await act(async () => host.querySelector<HTMLButtonElement>('.named-area-clear')!.click())
      await settle()
      expect(puts).toEqual([{ path: '/api/images/inn/areas/a', body: { box: null } }])
      expect(rows(host)[0]!.querySelector('.chip')!.textContent).toBe('To place')
      expect(selectedIds(host)).toEqual([0])
      expect(host.querySelector('.named-area-clear')).toBeNull()
      expect(document.activeElement).toBe(mainOf(host, 0))
      expect(line(host)).toContain('drag on the picture to place')
    })

    it('clears with the Delete key, focus staying on the row', async () => {
      const { host, puts } = await render([placedAt('a', box)])
      await act(async () => mainOf(host, 0).click())
      mainOf(host, 0).focus()
      await press(mainOf(host, 0), 'Delete')
      expect(puts[0]!.body).toEqual({ box: null })
      expect(document.activeElement).toBe(mainOf(host, 0))
    })
  })

  describe('the keyboard', () => {
    const box = { x: 100, y: 50, width: 60, height: 40 }
    const setup = async () => {
      const made = await render([placedAt('a', box)])
      await act(async () => mainOf(made.host, 0).click())
      return made
    }

    it('moves the selected box by a step with the arrow keys', async () => {
      const { host, puts } = await setup()
      await press(mainOf(host, 0), 'ArrowRight')
      await press(mainOf(host, 0), 'ArrowUp')
      expect(puts.map((p) => p.body.box)).toEqual([
        { ...box, x: 104 },
        { ...box, x: 104, y: 46 },
      ])
    })

    it('resizes by its right and bottom edges with Shift', async () => {
      const { host, puts } = await setup()
      await press(mainOf(host, 0), 'ArrowRight', true)
      await press(mainOf(host, 0), 'ArrowUp', true)
      expect(puts.map((p) => p.body.box)).toEqual([
        { ...box, width: 64 },
        { ...box, width: 64, height: 36 },
      ])
    })

    it('does nothing for an area still to place, and saves nothing at an edge', async () => {
      const edge = await render([placedAt('a', { x: 0, y: 0, width: 30, height: 30 })])
      await act(async () => mainOf(edge.host, 0).click())
      await press(mainOf(edge.host, 0), 'ArrowLeft')
      expect(edge.puts).toEqual([])
      const none = await render([area('a')])
      await press(mainOf(none.host, 0), 'ArrowRight')
      expect(none.puts).toEqual([])
    })

    it('clears with the Backspace key too, which is Mac’s delete key', async () => {
      const { host, puts } = await setup()
      await press(mainOf(host, 0), 'Backspace')
      expect(puts[0]!.body).toEqual({ box: null })
    })

    it('ignores keys pressed on the Clear button', async () => {
      const { host, puts } = await setup()
      await press(host.querySelector('.named-area-clear')!, 'ArrowRight')
      expect(puts).toEqual([])
    })

    it('reaches the rows, the Clear button, then the patch switches, by Tab', async () => {
      const patches = [{ id: 'p1', title: 'Bread taken', takes: [{ n: 7, chosen: true }] }]
      const { host } = await render([placedAt('a', box)], { patches })
      await act(async () => mainOf(host, 0).click())
      const order = [...host.querySelectorAll('button, input')].filter((e) => !isOff(e))
      expect(order.map((e) => e.className || e.tagName)).toEqual([
        'named-area-main',
        'btn named-area-clear',
        'INPUT',
      ])
    })

    it('reaches the rows, then the Clear button of the selected row, by Tab', async () => {
      const { host } = await setup()
      const tabbable = [...host.querySelectorAll('button')].filter((b) => !isOff(b))
      expect(tabbable.map((b) => b.className)).toEqual(['named-area-main', 'btn named-area-clear'])
      expect(host.querySelector('.named-area-stage')!.hasAttribute('tabindex')).toBe(false)
    })
  })

  describe('saving', () => {
    it('takes the box back, and says why under the explanation, when saving fails', async () => {
      const { host, stage } = await render([area('a', { title: 'Market stalls' })], {
        saved: {
          status: 409,
          body: { ok: false, problems: [{ file: 'f', path: '', message: 'the disk is full' }] },
        },
      })
      await drag(stage!, [20, 30], [120, 90])
      expect(host.querySelector('.adopt-error')!.textContent).toBe(
        '“Market stalls” could not be saved: the disk is full.',
      )
      expect(host.querySelector('.named-area-box')).toBeNull()
      expect(rows(host)[0]!.querySelector('.chip')!.textContent).toBe('To place')
      expect(host.querySelector('.named-areas-head')!.textContent).toContain('0 of 1 placed')
    })

    it('keeps the red line until a later change is saved', async () => {
      const { host, stage } = await render([area('a'), area('b')], {
        saved: { status: 500, body: {} },
      })
      await drag(stage!, [20, 30], [120, 90])
      expect(host.querySelector('.adopt-error')).not.toBeNull()
      await act(async () => mainOf(host, 1).click())
      expect(host.querySelector('.adopt-error')).not.toBeNull()
    })

    it('puts a cleared box back when clearing fails, and drops the line at the next change', async () => {
      const box = { x: 100, y: 50, width: 60, height: 40 }
      const { host } = await render([placedAt('a', box)], {
        saved: { status: 500, body: {} },
      })
      await act(async () => mainOf(host, 0).click())
      await act(async () => host.querySelector<HTMLButtonElement>('.named-area-clear')!.click())
      await settle()
      expect(host.querySelector('.adopt-error')!.textContent).toContain('could not be saved')
      expect(rows(host)[0]!.querySelector('.chip')!.textContent).toBe('Placed')
    })
  })

  describe('the titles on the picture', () => {
    it('cuts a long title short with an ellipsis, the row keeping it whole', async () => {
      const title = 'The very long name of the great market square'
      const { host } = await render([
        placedAt('a', { x: 100, y: 100, width: 10, height: 10 }, { title }),
      ])
      expect(tagOf(host, 'a').querySelector('span')!.textContent).toBe('The very long na…')
      expect(rows(host)[0]!.querySelector('b')!.textContent).toBe(title)
    })

    it('puts the tag under the box at the top of the picture, and to its right edge at the right', async () => {
      const { host } = await render([
        placedAt('top', { x: 10, y: 0, width: 40, height: 30 }),
        placedAt('right', { x: 280, y: 100, width: 40, height: 30 }),
        placedAt('mid', { x: 100, y: 100, width: 40, height: 30 }),
      ])
      expect(tagOf(host, 'top').className).toContain('low')
      expect(tagOf(host, 'right').className).toContain('right')
      expect(tagOf(host, 'mid').className).not.toMatch(/low|right/)
    })

    it('selects a box by pressing its tag, which is all there is to press on a tiny box', async () => {
      const { host, stage } = await render([
        placedAt('tiny', { x: 100, y: 100, width: 4, height: 4 }),
        placedAt('other', { x: 10, y: 10, width: 30, height: 30 }),
      ])
      await act(async () => mainOf(host, 1).click())
      await drag(stage!, [100, 100], [100, 100], tagOf(host, 'tiny').querySelector('span')!)
      expect(selectedIds(host)).toEqual([0])
    })

    it('follows the game’s new title for the same id, the box staying', async () => {
      const box = { x: 100, y: 100, width: 40, height: 30 }
      const { host } = await render([placedAt('a', box, { title: 'Well' })])
      expect(tagOf(host, 'a').querySelector('span')!.textContent).toBe('Well')
    })
  })

  describe('the chosen patches', () => {
    const patches = [
      { id: 'p1', title: 'Bread taken', takes: [{ n: 7, chosen: true }] },
      { id: 'p2', title: 'Lamp lit', takes: [{ n: 7, chosen: true }] },
    ]

    it('has no switches and no heading without chosen patches', async () => {
      const { host } = await render([area('a')])
      expect(host.textContent).not.toContain('Patches on the picture')
      expect(host.querySelector('input[type=checkbox]')).toBeNull()
      expect(host.querySelector('.named-area-hold')!.textContent).toBe('Hold S to hide the areas')
    })

    it('has a switch only for a patch with a chosen take, laying that take over', async () => {
      const { host } = await render([area('a')], {
        patches: [
          {
            id: 'p1',
            title: 'Bread taken',
            takes: [
              { n: 1, chosen: false },
              { n: 3, chosen: true },
            ],
          },
          { id: 'p2', title: 'Lamp lit', takes: [{ n: 2, chosen: false }] },
          { id: 'p3', title: 'No takes', takes: [] },
        ],
      })
      const labels = [...host.querySelectorAll('.named-area-switch')].map((l) => l.textContent)
      expect(labels).toEqual(['Bread taken'])
      const greyed = [...host.querySelectorAll('.named-area-switch-off')]
      expect(greyed.map((l) => [l.textContent, l.getAttribute('title')])).toEqual([
        ['Lamp lit', 'No take chosen yet'],
        ['No takes', 'No take chosen yet'],
      ])
      await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
      expect(host.querySelector<HTMLImageElement>('img.named-area-patch')!.src).toContain(
        '/api/images/inn/patches/p1/takes/3',
      )
    })

    it('has no switch for a patch the query does not list', async () => {
      const { host } = await render([area('a')], {
        answer: view({ patches: [] }),
        patches: [{ id: 'p1', title: 'Bread taken', takes: [{ n: 7, chosen: true }] }],
      })
      expect(host.querySelector('input[type=checkbox]')).toBeNull()
    })

    it('has a switch per patch, all off, that lays the patch over the picture', async () => {
      const { host } = await render([area('a'), area('b')], { patches })
      expect(host.querySelector('.named-area-switches')!.textContent).toContain(
        'Patches on the picture',
      )
      expect(host.querySelector('.named-area-switches')!.textContent).toEndWith(
        'Hold S to hide the areas',
      )
      const switches = [...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
      expect(switches.map((s) => s.checked)).toEqual([false, false])
      expect(host.querySelector('img.named-area-patch')).toBeNull()
      await act(async () => switches[1]!.click())
      expect(host.querySelector<HTMLImageElement>('img.named-area-patch')!.src).toContain(
        '/api/images/inn/patches/p2/takes/7',
      )
    })

    it('hides the boxes while S is held and shows them again on letting go', async () => {
      const box = { x: 10, y: 10, width: 20, height: 20 }
      const { host } = await render([placedAt('a', box), area('b')], { patches })
      await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
      expect(boxes(host)).toHaveLength(1)
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
      })
      expect(boxes(host)).toHaveLength(0)
      expect(host.querySelector('[data-point-of]')).toBeNull()
      expect(host.querySelectorAll('img.named-area-patch').length).toBe(1)
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 's', bubbles: true }))
      })
      expect(boxes(host)).toHaveLength(1)
    })

    it('shows the boxes again when the window loses focus while S is held', async () => {
      const box = { x: 10, y: 10, width: 20, height: 20 }
      const { host } = await render([placedAt('a', box)])
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'S', bubbles: true }))
      })
      expect(boxes(host)).toHaveLength(0)
      await act(async () => {
        window.dispatchEvent(new Event('blur'))
      })
      expect(boxes(host)).toHaveLength(1)
    })

    it('ignores S while typing in a field and with Command, Control or Option held', async () => {
      const box = { x: 10, y: 10, width: 20, height: 20 }
      const { host } = await render([placedAt('a', box)])
      const field = document.createElement('input')
      document.body.append(field)
      cleanups.push(() => field.remove())
      await act(async () => {
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
      })
      expect(boxes(host)).toHaveLength(1)
      for (const mod of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
        await act(async () => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, ...mod }))
        })
        expect(boxes(host)).toHaveLength(1)
      }
    })

    it('ignores S while its tab is not open, and shows the boxes again when the tab is left', async () => {
      const box = { x: 10, y: 10, width: 20, height: 20 }
      const closed = await render([placedAt('a', box)], { open: false })
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
      })
      expect(boxes(closed.host)).toHaveLength(1)
      const { host, setOpen } = await render([placedAt('a', box)])
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
      })
      expect(boxes(host)).toHaveLength(0)
      await setOpen(false)
      expect(boxes(host)).toHaveLength(1)
    })

    it('lets go of S on key-up even from inside a field', async () => {
      const box = { x: 10, y: 10, width: 20, height: 20 }
      const { host } = await render([placedAt('a', box)])
      const field = document.createElement('input')
      document.body.append(field)
      cleanups.push(() => field.remove())
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
      })
      await act(async () => {
        field.dispatchEvent(new KeyboardEvent('keyup', { key: 's', bubbles: true }))
      })
      expect(boxes(host)).toHaveLength(1)
    })

    it('does not draw, select or nudge unseen while S is held', async () => {
      const box = { x: 10, y: 10, width: 20, height: 20 }
      const { host, stage, puts } = await render([placedAt('a', box), area('b')])
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
      })
      await drag(stage!, [100, 100], [150, 150])
      await press(mainOf(host, 0), 'ArrowRight')
      expect(puts).toEqual([])
    })

    it('stays as left while moving between areas', async () => {
      const { host } = await render([area('a'), area('b')], { patches })
      await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
      await act(async () => mainOf(host, 1).click())
      expect(host.querySelectorAll('img.named-area-patch').length).toBe(1)
    })
  })
})

describe('areas to place again', () => {
  const again = (id: string, ...elsewhere: number[]) =>
    area(id, { elsewhere, boxes: Object.fromEntries(elsewhere.map((n) => [n, box])) })
  const box = { x: 10, y: 10, width: 40, height: 30 }
  const chips = (host: HTMLElement) => rows(host).map((r) => r.querySelector('.chip')?.textContent)
  const note = (host: HTMLElement) => host.querySelector('.place-again-line')?.textContent

  it('reads Place again for a box on another take, in the game’s order, with the line above the list', async () => {
    const { host } = await render(
      [again('a', 2), placedAt('b', box, { boxes: { 4: box } }), area('c'), again('d', 2)],
      { chosenTake: 4 },
    )
    expect(chips(host)).toEqual(['Place again', 'Placed', 'To place', 'Place again'])
    expect(host.textContent).toContain('1 of 4 placed')
    expect(note(host)).toBe(
      'Placed on take 2 of the image, so the game does not use them now. Place them here, or choose take 2 again to bring them back.',
    )
    const line = host.querySelector('.place-again-line')!
    expect(line.nextElementSibling?.classList.contains('named-areas-bar')).toBe(true)
    // The picture is clean: only the box of the take in the game shows.
    expect(boxes(host)).toHaveLength(1)
  })

  it('has no line while nothing reads Place again', async () => {
    const { host } = await render([placedAt('a', box), area('b')], { chosenTake: 4 })
    expect(note(host)).toBeUndefined()
  })

  it('says the singular words for one, and names every earlier take', async () => {
    const one = await render([again('a', 1, 2), area('b')], { chosenTake: 4 })
    expect(note(one.host)).toBe(
      'Placed on takes 1 and 2 of the image, so the game does not use it now. Place it here, or choose one of those takes again to bring it back.',
    )
  })

  it('names no take when it was dropped', async () => {
    const { host } = await render([area('a', { elsewhereGone: true })], { chosenTake: 4 })
    expect(chips(host)).toEqual(['Place again'])
    expect(note(host)).toBe(
      'Placed on an earlier take of the image, so the game does not use it now. Place it here.',
    )
  })

  it('keeps the rows off and names the way back only when no take is chosen', async () => {
    const { host } = await render([again('a', 2), again('b', 2)], {
      chosenTake: null,
      answer: view({ take: null }),
    })
    expect(chips(host)).toEqual(['Place again', 'Place again'])
    expect(isOff(mainOf(host, 0))).toBe(true)
    expect(host.textContent).toContain('Choose a take to mark the areas on it.')
    expect(note(host)).toBe(
      'Placed on take 2 of the image, so the game does not use them now. Choose take 2 again to bring them back.',
    )
  })

  it('shows Clear only on a row placed on the take in the game', async () => {
    const { host } = await render([again('a', 2), placedAt('b', box, { boxes: { 4: box } })], {
      chosenTake: 4,
    })
    expect(selectedIds(host)).toEqual([0])
    expect(host.querySelector('.named-area-clear')).toBeNull()
    await act(async () => mainOf(host, 1).click())
    expect(host.querySelector('.named-area-clear')).not.toBeNull()
  })

  it('selects the first area still needing a place when the take in the game changes', async () => {
    const { host, draw } = await render([area('x'), placedAt('a', box, { boxes: { 2: box } })], {
      chosenTake: 2,
    })
    expect(selectedIds(host)).toEqual([0])
    await act(async () => mainOf(host, 1).click())
    expect(selectedIds(host)).toEqual([1])
    await draw([again('x', 2), again('a', 2)], 4)
    await settle()
    expect(selectedIds(host)).toEqual([0])
  })
})

describe('the point of a box', () => {
  const box = { x: 100, y: 50, width: 60, height: 40 }
  const other = { x: 200, y: 100, width: 80, height: 50 }
  const dots = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.area-point')]
  const dotOf = (host: HTMLElement, id: string) =>
    host.querySelector<HTMLElement>(`[data-point-of="${id}"]`)
  /** Where a dot sits in its box, as a percentage each way. */
  const at = (dot: HTMLElement) => [parseFloat(dot.style.left), parseFloat(dot.style.top)]
  const setup = async (first: AreaBox = box) => {
    const made = await render([placedAt('a', first), placedAt('b', other)])
    await act(async () => mainOf(made.host, 0).click())
    return made
  }

  it('shows the full point at the centre of the selected box and small dots on the others', async () => {
    const { host } = await setup()
    expect(dotOf(host, 'a')!.classList.contains('small')).toBe(false)
    expect(at(dotOf(host, 'a')!)).toEqual([50, 50])
    expect(dotOf(host, 'b')!.classList.contains('small')).toBe(true)
    expect(host.querySelector('.named-area-point-centre')).toBeNull()
  })

  it('shows small dots on every box while none is selected, and none on a box being drawn', async () => {
    const { host, stage } = await render([placedAt('a', box), area('b')])
    expect(dots(host).map((d) => d.classList.contains('small'))).toEqual([true])
    await act(async () => mainOf(host, 1).click())
    await pointer(stage!, 'pointerdown', 10, 10)
    await pointer(stage!, 'pointermove', 60, 60)
    expect(host.querySelector('.drawing .area-point')).toBeNull()
  })

  it('draws the selected point small when the box is under 40 screen pixels each way', async () => {
    const wide = await setup({ x: 100, y: 50, width: 39, height: 40 })
    expect(dotOf(wide.host, 'a')!.classList.contains('small')).toBe(true)
    const tall = await setup({ x: 100, y: 50, width: 60, height: 39 })
    expect(dotOf(tall.host, 'a')!.classList.contains('small')).toBe(true)
    const ok = await setup({ x: 100, y: 50, width: 40, height: 40 })
    expect(dotOf(ok.host, 'a')!.classList.contains('small')).toBe(false)
  })

  it('moves by a drag on the point, saved at the drop, and shows Centre the point', async () => {
    const { host, stage, puts } = await setup()
    await drag(stage!, [130, 70], [110, 60], dotOf(host, 'a')!)
    expect(puts.map((p) => p.body.box)).toEqual([{ ...box, point: { x: 110, y: 60 } }])
    expect(at(dotOf(host, 'a')!).map(Math.round)).toEqual([17, 25])
    const centre = host.querySelector('.named-area-point-centre')!
    expect(centre.textContent).toBe('Centre the point')
    expect(centre.nextElementSibling!.textContent).toBe('Clear')
    expect(document.activeElement).toBe(mainOf(host, 0))
  })

  it('stops at the box’s edges and never moves the box', async () => {
    const { host, stage, puts } = await setup()
    await drag(stage!, [130, 70], [500, -20], dotOf(host, 'a')!)
    expect(puts[0]!.body.box).toEqual({ ...box, point: { x: 160, y: 50 } })
  })

  it('saves nothing for a press on the point that does not move it', async () => {
    const { host, stage, puts } = await setup()
    await drag(stage!, [130, 70], [130, 70], dotOf(host, 'a')!)
    expect(puts).toEqual([])
  })

  it('selects a box by pressing its small dot, as a click does', async () => {
    const { host, stage, puts } = await setup()
    await drag(stage!, [240, 125], [240, 125], dotOf(host, 'b')!)
    expect(puts).toEqual([])
    expect(selectedIds(host)).toEqual([1])
  })

  it('moves with Alt and the arrow keys by the step, focus staying on the row', async () => {
    const { host, puts } = await setup()
    mainOf(host, 0).focus()
    await press(mainOf(host, 0), 'ArrowRight', false, true)
    await press(mainOf(host, 0), 'ArrowDown', false, true)
    expect(puts.map((p) => p.body.box)).toEqual([
      { ...box, point: { x: 134, y: 70 } },
      { ...box, point: { x: 134, y: 74 } },
    ])
    expect(document.activeElement).toBe(mainOf(host, 0))
  })

  it('is drawn above the handles, so a press on a point sitting on a corner moves the point', async () => {
    // A browser hands a press to the topmost element under it; with no z-index of their own, the
    // later of two positioned siblings is the one on top.
    const { host, stage, puts } = await setup({ ...box, point: { x: 160, y: 90 } })
    const inBox = [...tagOf(host, 'a').children]
    const point = dotOf(host, 'a')!
    const handles = [...tagOf(host, 'a').querySelectorAll('.handle')]
    for (const handle of handles) {
      expect(inBox.indexOf(point)).toBeGreaterThan(inBox.indexOf(handle))
      expect(valuesInEveryWindow(handle, 'z-index')).toEqual([])
      expect(valuesInEveryWindow(handle, 'position')).toContain('.named-area-box .handle: absolute')
    }
    expect(valuesInEveryWindow(point, 'z-index')).toEqual([])
    expect(valuesInEveryWindow(point, 'position')).toContain('.area-point: absolute')
    // The order above is the bug; this drag only proves a press on the point still saves the point.
    await drag(stage!, [160, 90], [140, 80], point)
    expect(puts.map((p) => p.body.box)).toEqual([{ ...box, point: { x: 140, y: 80 } }])
  })

  it('stops at the edge with Alt and saves nothing when it cannot move', async () => {
    const { host, puts } = await setup({ ...box, point: { x: 160, y: 70 } })
    await press(mainOf(host, 0), 'ArrowRight', false, true)
    expect(puts).toEqual([])
  })

  it('stays on the same spot when the box is moved or resized, pushed to the edge if no longer covered', async () => {
    const pointed = { ...box, point: { x: 110, y: 60 } }
    const moved = await setup(pointed)
    await press(mainOf(moved.host, 0), 'ArrowRight')
    expect(moved.puts[0]!.body.box).toEqual({ ...pointed, x: 104, point: { x: 110, y: 60 } })
    const resized = await setup(pointed)
    await drag(resized.stage!, [100, 70], [130, 70], resized.host.querySelector('.handle-w')!)
    expect(resized.puts[0]!.body.box).toEqual({
      x: 130,
      y: 50,
      width: 30,
      height: 40,
      point: { x: 130, y: 60 },
    })
  })

  it('leaves a point never moved at the centre when the box is resized', async () => {
    const { host, stage, puts } = await setup()
    await drag(stage!, [160, 90], [200, 120], host.querySelector('.handle-se')!)
    expect(puts[0]!.body.box).toEqual({ x: 100, y: 50, width: 100, height: 70 })
  })

  it('goes back to the centre from the button, which then disappears', async () => {
    const { host, puts } = await setup({ ...box, point: { x: 110, y: 60 } })
    await act(async () =>
      host.querySelector<HTMLButtonElement>('.named-area-point-centre')!.click(),
    )
    await settle()
    expect(puts.map((p) => p.body.box)).toEqual([box])
    expect(host.querySelector('.named-area-point-centre')).toBeNull()
    expect(document.activeElement).toBe(mainOf(host, 0))
  })

  it('has no Centre button on rows that are not selected', async () => {
    const { host } = await render([placedAt('a', { ...box, point: { x: 110, y: 60 } })])
    expect(host.querySelector('.named-area-point-centre')).toBeNull()
  })

  it('takes the point away with the box on Clear', async () => {
    const { host, puts } = await setup({ ...box, point: { x: 110, y: 60 } })
    await act(async () => host.querySelector<HTMLButtonElement>('.named-area-clear')!.click())
    await settle()
    expect(puts[0]!.body).toEqual({ box: null })
  })

  it('starts a box drawn after Clear with its point at the centre', async () => {
    const { host, stage, puts } = await setup({ ...box, point: { x: 110, y: 60 } })
    await act(async () => host.querySelector<HTMLButtonElement>('.named-area-clear')!.click())
    await settle()
    await drag(stage!, [10, 10], [70, 50])
    expect(puts[1]!.body.box).toEqual({ x: 10, y: 10, width: 60, height: 40 })
  })

  it('lets presses through the dot of a box too small to grab by it', async () => {
    const { host } = await setup({ x: 100, y: 50, width: 8, height: 8 })
    expect(dotOf(host, 'a')!.classList.contains('tiny')).toBe(true)
  })

  it('names the selected point and hides the small dots from assistive tools', async () => {
    const { host } = await setup()
    expect(dotOf(host, 'a')!.getAttribute('aria-label')).toBe('Point of Title of a')
    expect(dotOf(host, 'b')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('draws the point small when the window narrows under a selected box', async () => {
    const { host, stage } = await setup()
    expect(dotOf(host, 'a')!.classList.contains('small')).toBe(false)
    stage!.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 62 }) as DOMRect
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(dotOf(host, 'a')!.classList.contains('small')).toBe(true)
  })

  it('goes back to where it was and names the area when saving fails', async () => {
    const { host, stage } = await render([placedAt('a', box)], {
      saved: { status: 409, body: { ok: false, problems: [{ message: 'no room' }] } },
    })
    await act(async () => mainOf(host, 0).click())
    await drag(stage!, [130, 70], [110, 60], dotOf(host, 'a')!)
    expect(host.querySelector('[role="alert"]')!.textContent).toBe(
      '“Title of a” could not be saved: no room.',
    )
    expect(at(dotOf(host, 'a')!)).toEqual([50, 50])
    expect(host.querySelector('.named-area-point-centre')).toBeNull()
  })

  it('says how to choose where What’s there marks the area', async () => {
    const { host } = await setup()
    expect(line(host)).toBe(
      'Take 2 · drag the box to move it, or its corners and sides to resize it. Drag the point to choose where What’s there marks it. Arrow keys move the box; with Shift they resize it; with Alt they move the point.',
    )
  })
})

describe('the pinned bar and the full-width picture (as-uucl.4)', () => {
  const box = { x: 100, y: 50, width: 60, height: 40 }
  const patches = [{ id: 'p1', title: 'Bread taken', takes: [{ n: 7, chosen: true }] }]

  it('reads top to bottom: heading, bar (row, then switches), picture, caption', async () => {
    const { host } = await render([placedAt('a', box), area('b')], { patches })
    const bar = host.querySelector('.named-areas-bar')!
    expect(bar.querySelector('.named-area-list')).not.toBeNull()
    expect(bar.querySelector('.named-area-switches')).toBe(bar.lastElementChild)
    const section = host.querySelector('section')!
    const order = [...section.children].map((c) => c.className)
    expect(order).toEqual(['named-areas-head', 'named-areas-bar', 'named-areas-picture'])
    const picture = host.querySelector('.named-areas-picture')!
    expect([...picture.children].map((c) => c.className)).toEqual([
      'named-area-stage',
      'muted named-area-line',
    ])
  })

  it('tabs through the area buttons, then the chosen area’s buttons, then the switches', async () => {
    const { host } = await render(
      [placedAt('a', { ...box, point: { x: 110, y: 60 } }), area('b')],
      {
        patches,
      },
    )
    await act(async () => mainOf(host, 0).click())
    const order = [...host.querySelectorAll('.named-areas-bar button, .named-areas-bar input')]
    expect(order.map((e) => e.className || e.tagName)).toEqual([
      'named-area-main',
      'named-area-main',
      'btn named-area-point-centre',
      'btn named-area-clear',
      'INPUT',
    ])
  })

  it('puts the chosen area’s title, Centre the point and Clear at the row’s end, for it alone', async () => {
    const { host } = await render([
      placedAt('a', { ...box, point: { x: 110, y: 60 } }, { title: 'Hearth' }),
      placedAt('b', box),
    ])
    expect(host.querySelector('.named-area-actions')).toBeNull()
    await act(async () => mainOf(host, 0).click())
    const actions = host.querySelector('.named-area-actions')!
    expect(actions.parentElement).toBe(host.querySelector('.named-area-list'))
    expect(actions.parentElement!.lastElementChild).toBe(actions)
    expect(text(actions)).toBe('Hearth:Centre the pointClear')
    await act(async () => mainOf(host, 1).click())
    expect(text(host.querySelector('.named-area-actions')!)).toBe('Title of b:Clear')
  })

  it('sizes the picture by its own pixels, never upscaled, left-aligned', async () => {
    for (const size of [
      { width: 1536, height: 1024 },
      { width: 320, height: 200 },
    ]) {
      const { stage } = await render([area('a')], { size })
      expect(stage!.style.maxWidth).toBe(`${size.width}px`)
      expect(stage!.style.aspectRatio).toBe(`${size.width} / ${size.height}`)
      expect(stage!.classList.contains('fit-shape')).toBe(false)
    }
  })

  it('keeps the same shape for the empty box and the row of areas', async () => {
    const { host } = await render([area('a')], {
      size: { width: 160, height: 200 },
      answer: () => new Promise<Response>(() => {}),
    })
    const empty = host.querySelector<HTMLElement>('.named-area-empty')!
    expect(empty.style.maxWidth).toBe('160px')
    expect(empty.style.aspectRatio).toBe('160 / 200')
    expect(rows(host)).toHaveLength(1)
  })

  describe('scrolling to the chosen area', () => {
    const scrolls = () => {
      const height = window.innerHeight
      window.innerHeight = 800
      cleanups.push(() => (window.innerHeight = height))
      const calls: ScrollToOptions[] = []
      const real = window.scrollBy
      window.scrollBy = ((o: ScrollToOptions) => void calls.push(o)) as typeof window.scrollBy
      cleanups.push(() => (window.scrollBy = real))
      return calls
    }
    const place = (host: HTMLElement, top: number, bottom: number) => {
      host.querySelector('.named-areas-bar')!.getBoundingClientRect = () =>
        ({ top: 0, bottom: 100 }) as DOMRect
      tagOf(host, 'a').getBoundingClientRect = () => ({ top, bottom }) as DOMRect
    }

    it('scrolls smoothly when the pressed area’s box is out of sight', async () => {
      const calls = scrolls()
      const { host } = await render([placedAt('a', box), area('b')], { chosenTake: 2 })
      place(host, 900, 1000)
      await act(async () => mainOf(host, 0).click())
      expect(calls).toEqual([{ top: 208, behavior: 'smooth' }])
    })

    it('measures the bar after the chosen area’s buttons are in it', async () => {
      const calls = scrolls()
      const { host } = await render([placedAt('a', box), placedAt('b', box)], { chosenTake: 2 })
      // The bar is 100 high, and 36 higher once a chosen area's buttons are on a new line.
      const list = host.querySelector('.named-area-list')!
      host.querySelector('.named-areas-bar')!.getBoundingClientRect = () =>
        ({ top: 0, bottom: list.querySelector('.named-area-actions') ? 136 : 100 }) as DOMRect
      tagOf(host, 'a').getBoundingClientRect = () => ({ top: 20, bottom: 60 }) as DOMRect
      await act(async () => mainOf(host, 0).click())
      expect(calls).toEqual([{ top: 20 - 136 - 8, behavior: 'smooth' }])
    })

    it('does not move for a box partly in view', async () => {
      const calls = scrolls()
      const { host } = await render([placedAt('a', box)], { chosenTake: 2 })
      place(host, 700, 900)
      await act(async () => mainOf(host, 0).click())
      expect(calls).toEqual([])
    })

    it('does not move for a box in view, or an area with no box', async () => {
      const calls = scrolls()
      const { host } = await render([placedAt('a', box), area('b')], { chosenTake: 2 })
      place(host, 300, 400)
      await act(async () => mainOf(host, 0).click())
      await act(async () => mainOf(host, 1).click())
      expect(calls).toEqual([])
    })
  })

  it('stops a drag at the window’s edge and never scrolls the page by itself', async () => {
    const calls: unknown[] = []
    const real = window.scrollBy
    window.scrollBy = ((o: unknown) => void calls.push(o)) as typeof window.scrollBy
    cleanups.push(() => (window.scrollBy = real))
    const height = window.innerHeight
    window.innerHeight = 100
    cleanups.push(() => (window.innerHeight = height))
    const { host, stage, puts } = await render([area('a')])
    host.querySelector('.named-areas-bar')!.getBoundingClientRect = () =>
      ({ top: 0, bottom: 20 }) as DOMRect
    await drag(stage!, [10, 60], [50, 190])
    expect(puts[0]!.body.box).toEqual({ x: 10, y: 60, width: 40, height: 40 })
    await drag(stage!, [100, 60], [140, -30])
    expect(puts[1]!.body.box).toEqual({ x: 100, y: 20, width: 40, height: 40 })
    expect(calls).toEqual([])
  })
})
