import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ImagesRoute } from '../../route'
import type { GameArea, GamePatch, ImageEdits, ImageStyle, MadeFrom } from '../../../core/images'
import type { ImageTakesView } from '../../../core/imageTakes'
import type { ProjectSummary } from '../../../core/summary'
import { minWidthsInEveryWindow } from '../../../../test/stylesheet'
import { projectJson } from '../../../../test/helpers'
import { ProjectSchema } from '../../../core/project'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const isOff = (element: Element) => element.getAttribute('aria-disabled') === 'true'
const { act, createElement } = await import('react')
const { WhyTip } = await import('../../components/WhyTip')
const act_ = act
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { summarizeImages } = await import('../../../core/images')
const { lookKey, lookOf } = await import('../../../core/imageLook')
const { ImagesView } = await import('./ImagesView')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
// A page left mounted would keep hearing the document's keys in the next test.
afterEach(() => cleanups.splice(0).forEach((c) => c()))
afterAll(() => {
  cleanups.forEach((c) => c())
  GlobalRegistrator.unregister()
})

// What the page sent to the studio, and the answer it gets.
const sent: { method: string; path: string; body: unknown }[] = []
beforeEach(() => {
  sent.length = 0
  globalThis.fetch = (async (path: string, init?: RequestInit) => {
    sent.push({
      method: init?.method ?? 'GET',
      path,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
    return Response.json({ ok: true })
  }) as unknown as typeof fetch
})

const style: ImageStyle = {
  look: 'flat pixel art',
  keepOut: 'text',
  palette: ['#000000', '#ffffff'],
  parts: { act1: 'lantern light' },
}
const inn = {
  id: 'inn',
  title: 'The Inn',
  description: 'a low inn',
  width: 320,
  height: 200,
  patches: [] as GamePatch[],
  areas: [] as GameArea[],
}
const barn = {
  id: 'barn',
  title: 'The Barn',
  description: 'a barn',
  width: 160,
  height: 100,
  patches: [] as GamePatch[],
  areas: [] as GameArea[],
}

interface Options {
  edits?: ImageEdits['images']
  chosen?: Record<string, MadeFrom>
  /** The images lock cannot be read. */
  lockUnread?: boolean
  style?: ImageStyle | null
  editsInvalid?: boolean
  actTwo?: 'missing' | 'empty'
  /** The patches the game asks for on the inn. */
  patches?: GamePatch[]
  /** The named areas the game wants placed on the inn. */
  areas?: GameArea[]
  /** The images Act II lists (overrides `actTwo`). */
  actTwoImages?: (typeof inn)[]
  /** What the chosen pictures were brought to; the look now when absent. */
  lookWas?: string
  /** The inn's chosen take, and the takes its patches are chosen on (by patch id) and its board has. */
  gameTake?: number
  choices?: Record<string, number[]>
  imageTakes?: number[]
  /** The area each patch's chosen take was made with, by patch id then take of the image. */
  patchAreas?: Record<
    string,
    Record<number, { x: number; y: number; width: number; height: number }>
  >
}

function summary(options: Options = {}): ProjectSummary {
  const { images } = summarizeImages({
    parts: [
      { id: 'act1', title: 'Act I: The Lantern' },
      { id: 'act2', title: 'Act II: The Road' },
    ],
    lists: [
      {
        id: 'act1',
        title: 'Act I: The Lantern',
        file: 'a1.json',
        state: {
          status: 'ok',
          images: [{ ...inn, patches: options.patches ?? [], areas: options.areas ?? [] }, barn],
        },
        canRefresh: true,
      },
      {
        id: 'act2',
        title: 'Act II: The Road',
        file: 'a2.json',
        state: options.actTwoImages
          ? { status: 'ok', images: options.actTwoImages }
          : options.actTwo === 'empty'
            ? { status: 'ok', images: [] }
            : { status: 'missing' },
        canRefresh: false,
      },
    ],
    editsFile: 'content-studio/images/edits.json',
    editsInvalid: options.editsInvalid,
    style: options.style === undefined ? style : options.style,
    edits: options.edits ?? {},
    chosen: options.lockUnread
      ? { read: false }
      : {
          read: true,
          entries: Object.fromEntries(
            Object.entries(options.chosen ?? {}).map(([id, made]) => [
              id,
              {
                ...made,
                ...(id === 'inn' && options.gameTake !== undefined
                  ? { take: options.gameTake }
                  : {}),
                look: options.lookWas ?? lookKey(lookOf(style), id === 'inn' ? inn : barn),
              },
            ]),
          ),
        },
    look: lookOf(style),
    ...(options.choices ? { patchChoices: { inn: options.choices } } : {}),
    ...(options.patchAreas ? { patchAreas: { inn: options.patchAreas } } : {}),
    ...(options.imageTakes ? { imageTakes: { inn: options.imageTakes } } : {}),
  })
  return { images } as unknown as ProjectSummary
}

/** The inn's takes when it has none and takes can be made. */
const noTakes: ImageTakesView = {
  ok: true,
  generator: { ok: true },
  projectModel: 'klein',
  models: [
    { id: 'klein', installed: true, download: 'whole', failed: false },
    { id: 'z-image-turbo', installed: true, download: 'whole', failed: false },
    { id: 'qwen-image', installed: true, download: 'whole', failed: false },
  ],
  takes: [],
  making: [],
  failed: [],
  lockUnread: false,
  lookError: null,
}

function render(
  route: ImagesRoute,
  shown: ProjectSummary = summary(),
  making: Record<string, { takes: number; left: number; failed?: number; stopped?: number }> = {},
  run: unknown = null,
  modelState = false,
  takes?: Partial<ImageTakesView>,
  seed?: (client: InstanceType<typeof QueryClient>) => void,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(['image-making'], making)
  if (takes) client.setQueryData(['image-takes', 'inn'], { ...noTakes, ...takes })
  client.setQueryData(['look-run'], run)
  seed?.(client)
  if (modelState) {
    const whole = { download: 'whole', failed: false }
    client.setQueryData(['image-model-state'], {
      ok: true,
      main: 'klein',
      ready: true,
      states: { klein: whole, 'z-image-turbo': whole, 'qwen-image': whole },
    })
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(WhyTip),
        createElement(ImagesView, { summary: shown, route }),
      ),
    ),
  )
  return container
}

const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim()
const button = (page: HTMLElement, label: string) =>
  [...page.querySelectorAll('button')].find((b) => b.textContent === label)!
const flush = () => act(async () => {})

describe('no images section', () => {
  it('shows the box and the example', () => {
    const page = render({ view: 'images', page: null }, {
      images: null,
    } as unknown as ProjectSummary)
    expect(text(page.querySelector('h1'))).toBe('Images')
    expect(text(page.querySelector('.panel'))).toContain('This project has no images yet')
    act(() => button(page, 'How to set it up').click())
    expect(page.querySelector('pre')?.textContent).toContain('"images": {')
  })

  it('shows an images section the studio accepts', () => {
    const page = render({ view: 'images', page: null }, {
      images: null,
    } as unknown as ProjectSummary)
    act(() => button(page, 'How to set it up').click())
    const example = JSON.parse(`{${page.querySelector('pre')!.textContent}}`)
    const parsed = ProjectSchema.safeParse({ ...projectJson(), ...example })
    expect(parsed.error?.issues ?? []).toEqual([])
  })
})

describe('an act’s page', () => {
  it('has the crumb, heading, count line, style line and table', () => {
    const page = render({ view: 'images', page: 'act', part: 'act1' })
    expect(text(page.querySelector('.crumbs'))).toBe('Images')
    expect(text(page.querySelector('h1'))).toBe('Act I')
    expect(text(page.querySelector('.page-header .muted'))).toBe(
      'The images the game asks for in Act I. 0 of 2 chosen.',
    )
    expect(text(page.querySelector('.images-style-line'))).toBe(
      'Every prompt ends with the style, and for Act I: lantern light. Style ›',
    )
    expect([...page.querySelectorAll('th')].map((th) => th.textContent)).toEqual([
      'Image',
      'Prompt',
      'Size',
      'Status',
    ])
    const row = page.querySelector('tbody tr')!
    expect(text(row.querySelector('td'))).toBe('The Inninn')
    expect(text(row)).toContain('320 × 200')
    expect(text(row)).toContain('none yet')
    expect(button(page, 'Refresh from the game')).toBeTruthy()
  })

  it('stops the style line after the style when the act has no addition, and drops it without a style', () => {
    const page = render({ view: 'images', page: 'act', part: 'act2' }, summary({ actTwo: 'empty' }))
    expect(text(page.querySelector('.images-style-line'))).toBe(
      'Every prompt ends with the style. Style ›',
    )
    expect(text(page)).toContain('The game asks for no images in Act II.')
    const none = render({ view: 'images', page: 'act', part: 'act1' }, summary({ style: null }))
    expect(none.querySelector('.images-style-line')).toBeNull()
  })

  it('shows the takes being made in an image’s status, rounded like every image time', () => {
    const page = render({ view: 'images', page: 'act', part: 'act1' }, summary(), {
      inn: { takes: 2, left: 50 },
    })
    const rows = [...page.querySelectorAll('tbody tr')]
    expect(text(rows[0]!.querySelector('.images-status'))).toBe('making 2 takes · about 50 s')
    expect(text(rows[1]!.querySelector('.images-status'))).toBe('none yet')
  })

  it('shows an image whose takes all failed with its status, not as making', () => {
    const page = render({ view: 'images', page: 'act', part: 'act1' }, summary(), {
      inn: { takes: 0, left: 0, failed: 2 },
    })
    const rows = [...page.querySelectorAll('tbody tr')]
    expect(text(rows[0]!.querySelector('.images-status'))).toBe('none yet')
  })

  it('offers to make takes beside the count, for the whole act even when showing what needs attention', () => {
    const page = render(
      { view: 'images', page: 'act', part: 'act1', show: 'attention' },
      summary(),
      {},
      null,
      true,
    )
    const panel = page.querySelector('.status-panel')!
    expect(text(panel)).toContain('2 images have no chosen take')
    expect(text(panel.querySelector('.make-all-line'))).toContain('Make 4 takes each')
    expect(page.querySelector('.page-header')!.textContent).not.toContain('Make 4 takes each')
  })

  it('says so when the game asks for no images in an act', () => {
    const page = render({ view: 'images', page: 'act', part: 'act2' }, summary({ actTwo: 'empty' }))
    expect(text(page)).toContain('The game asks for no images in Act II.')
  })

  it('says when the game has not listed the act yet', () => {
    const page = render({ view: 'images', page: 'act', part: 'act2' })
    expect(text(page)).toContain(
      'The game has not listed the images for Act II yet. Refresh from the game.',
    )
  })

  it('marks the user’s words, and that the game’s changed too', () => {
    const edits = {
      inn: { text: 'cosy', gameWas: 'older' },
      barn: { text: 'red barn', gameWas: 'a barn' },
    }
    const rows = [
      ...render({ view: 'images', page: 'act', part: 'act1' }, summary({ edits })).querySelectorAll(
        'tbody tr',
      ),
    ]
    expect(text(rows[0])).toContain("changed here · the game's words changed too")
    expect(text(rows[1])).toContain('changed here')
    expect(text(rows[1])).not.toContain('too')
  })

  it('says not known, and gives no count, while the images lock cannot be read', () => {
    const page = render(
      { view: 'images', page: 'act', part: 'act1' },
      summary({ lockUnread: true }),
    )
    const chips = [...page.querySelectorAll('.images-status .chip')].map((c) => c.textContent)
    expect(chips).toEqual(['not known', 'not known'])
    expect(text(page.querySelector('.page-header .muted'))).toBe(
      'The images the game asks for in Act I.',
    )
  })

  it('shows chosen and out of date', () => {
    const first = summary().images!.acts[0]!.rows
    const chosen = { inn: first[0]!.madeFrom, barn: { ...first[1]!.madeFrom, width: 1 } }
    const page = render({ view: 'images', page: 'act', part: 'act1' }, summary({ chosen }))
    const chips = [...page.querySelectorAll('.images-status .chip')].map((c) => c.textContent)
    expect(chips).toEqual(['chosen', 'out of date'])
    expect(text(page.querySelector('.page-header .muted'))).toContain('2 of 2 chosen')
  })
})

describe('an image’s page', () => {
  const route: ImagesRoute = { view: 'images', page: 'image', image: 'inn' }

  it('shows the crumb, title, id and size, and the field holding the game’s words', () => {
    const page = render(route)
    expect(text(page.querySelector('.crumbs'))).toBe('Images › Act I')
    expect(text(page.querySelector('h1'))).toBe('The Inn')
    expect(text(page.querySelector('.page-header .mono'))).toBe('inn')
    expect(text(page.querySelector('.images-look-line'))).toBe(
      "320 × 200 · the game's palette, 2 colours · patterned dithering",
    )
    const field = page.querySelector('textarea')!
    expect(field.value).toBe('a low inn')
    expect(text(page.querySelector('label'))).toBe('What the image shows')
    expect(text(page.querySelector('.field-tag'))).toBe('from the game')
    expect(page.querySelector('details summary')?.textContent).toBe(
      'The whole prompt the model gets',
    )
    expect(page.querySelector('details pre')?.textContent).toBe(
      'a low inn\nlantern light\nflat pixel art\nKept out: text',
    )
  })

  it('steps to the other image of the act by its buttons only, and the arrow keys leave it alone', () => {
    window.location.hash = '#/start'
    const page = render(route)
    const [prev, next] = [...page.querySelectorAll<HTMLButtonElement>('.pager button')]
    expect(text(page.querySelector('.pager'))).toBe('‹1 of 2›')
    expect(prev!.getAttribute('aria-disabled')).toBe('true')
    expect(next!.title).toBe('Next: The Barn')
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      )
    })
    expect(window.location.hash).toBe('#/start')
    act(() => next!.click())
    expect(window.location.hash).toBe('#/images/items/barn?from=act1')
  })

  it('saves the words when the field is left, and shows Saved', async () => {
    const page = render(route)
    const field = page.querySelector('textarea')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        field,
        'a cosy inn',
      )
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    await flush()
    expect(sent[0]).toEqual({
      method: 'PATCH',
      path: '/api/images/inn',
      body: { words: 'a cosy inn' },
    })
    expect(text(page.querySelector('.saved'))).toBe('Saved')
  })

  it('names the user’s own words, shows the game’s, and takes them back', async () => {
    const edits = { inn: { text: 'cosy', gameWas: 'a low inn' } }
    const page = render(route, summary({ edits }))
    expect(text(page.querySelector('.field-tag'))).toBe("changed here · use the game's")
    expect(text(page)).toContain("The game's words: a low inn")
    await act(async () => button(page, "use the game's").click())
    expect(sent[0]).toEqual({ method: 'PATCH', path: '/api/images/inn', body: { words: null } })
  })

  describe('Make pressed straight after typing the prompt (as-95q)', () => {
    /** The page with a new prompt typed and `press` pressed at once, whose save waits for `release`. */
    async function typedAndPressed(
      answer: () => Response,
      press = 'Make 4 takes',
      takes: Partial<ImageTakesView> = {},
    ) {
      const page = render(route, summary(), {}, null, false, takes)
      const served = globalThis.fetch
      let release = () => {}
      const held = new Promise<void>((resolve) => (release = resolve))
      globalThis.fetch = (async (path: string, init?: RequestInit) => {
        if (init?.method !== 'PATCH') return served(path, init)
        sent.push({ method: 'PATCH', path, body: JSON.parse(String(init.body)) })
        await held
        return answer()
      }) as unknown as typeof fetch
      const field = page.querySelector('textarea')!
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      await act(async () => {
        set.call(field, 'a cosy inn')
        field.dispatchEvent(new Event('input', { bubbles: true }))
      })
      // The press of the mouse leaves the field; the click comes before anything has rendered.
      await act(async () => {
        field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
        button(page, press).click()
      })
      await settle()
      return { page, release }
    }
    // React Query tells the page on a timer, so a real turn of the clock lets the answer show.
    const settle = async () => {
      for (let i = 0; i < 5; i++) await act(async () => await new Promise((r) => setTimeout(r, 5)))
    }
    const asked = () => sent.filter((s) => s.method !== 'GET').map((s) => s.method)
    const takesAsked = () =>
      sent.filter((s) => s.method === 'POST' && s.path === '/api/images/inn/takes')

    it('asks for the takes only once the prompt is saved', async () => {
      const { release } = await typedAndPressed(() => Response.json({ ok: true }))
      expect(asked()).toEqual(['PATCH'])
      await act(async () => release())
      await settle()
      expect(asked()).toEqual(['PATCH', 'POST'])
      expect(takesAsked()).toHaveLength(1)
    })

    it('keeps Make off while it waits, so a second press asks for nothing more', async () => {
      const { page, release } = await typedAndPressed(() => Response.json({ ok: true }))
      expect(isOff(button(page, 'Make 4 takes'))).toBe(true)
      await act(async () => button(page, 'Make 4 takes').click())
      await act(async () => release())
      await settle()
      expect(takesAsked()).toHaveLength(1)
    })

    it('makes nothing when the prompt could not be saved, and says why', async () => {
      const { page, release } = await typedAndPressed(() =>
        Response.json({
          ok: false,
          problems: [{ file: 'edits.json', path: 'words', message: 'Too long' }],
        }),
      )
      await act(async () => release())
      await settle()
      expect(takesAsked()).toEqual([])
      expect(text(page)).toContain('Too long')
      expect(isOff(button(page, 'Make 4 takes'))).toBe(false)
    })

    it('makes nothing when the save itself failed', async () => {
      const { page, release } = await typedAndPressed(() => new Response('', { status: 500 }))
      await act(async () => release())
      await settle()
      expect(takesAsked()).toEqual([])
      expect(isOff(button(page, 'Make 4 takes'))).toBe(false)
    })

    describe('Try again on a failed take, which is made from the prompt as it stands', () => {
      const oneFailed = { failed: [{ n: 1, message: 'It broke.' }] }

      it('asks for the take only once the prompt is saved', async () => {
        const { release } = await typedAndPressed(
          () => Response.json({ ok: true }),
          'Try again',
          oneFailed,
        )
        expect(asked()).toEqual(['PATCH'])
        await act(async () => release())
        await settle()
        expect(asked()).toEqual(['PATCH', 'POST'])
        expect(takesAsked()[0]!.body).toEqual({ retry: 1 })
      })

      it('makes nothing when the prompt could not be saved', async () => {
        const { release } = await typedAndPressed(
          () => new Response('', { status: 500 }),
          'Try again',
          oneFailed,
        )
        await act(async () => release())
        await settle()
        expect(takesAsked()).toEqual([])
      })

      it('is off while a press of Make waits for the prompt', async () => {
        const { page, release } = await typedAndPressed(
          () => Response.json({ ok: true }),
          'Make 4 takes',
          oneFailed,
        )
        expect(isOff(button(page, 'Try again'))).toBe(true)
        await act(async () => release())
        await settle()
      })
    })

    it('asks for the takes at once when nothing was typed', async () => {
      const page = render(route, summary(), {}, null, false, {})
      await act(async () => button(page, 'Make 4 takes').click())
      await settle()
      expect(asked()).toEqual(['POST'])
    })
  })

  describe('the act’s style on an image', () => {
    const box = (page: HTMLElement) => page.querySelector<HTMLInputElement>('.act-style-box input')!
    it('is a ticked box after the words, with the act’s style text, and the whole prompt has it', () => {
      const page = render(route)
      const spans = [...page.querySelectorAll('.act-style-box span span')]
      expect(spans.map((n) => text(n))).toEqual([
        "Add Act I's style to this image",
        'lantern light',
      ])
      expect(box(page).type).toBe('checkbox')
      expect(box(page).checked).toBe(true)
      const order = [...page.querySelectorAll('textarea, .act-style-box input')]
      expect(order.map((n) => n.tagName)).toEqual(['TEXTAREA', 'INPUT'])
      expect(text(page.querySelector('.images-whole pre'))).toContain('lantern light')
    })
    it('saves at once when unticked, and says Saved', async () => {
      const page = render(route)
      await act(async () => box(page).click())
      expect(sent[0]).toEqual({
        method: 'PATCH',
        path: '/api/images/inn/act-style',
        body: { on: false },
      })
      expect(text(page.querySelector('.saved'))).toBe('Saved')
    })
    it('shows an image that leaves it out struck through, with no act line, and a note on the act page', () => {
      const edits = { inn: { partStyle: null } }
      const page = render(route, summary({ edits }))
      expect(box(page).checked).toBe(false)
      expect(page.querySelector('.act-style-box .act-style-off')).not.toBeNull()
      expect(text(page.querySelector('.images-whole pre'))).not.toContain('lantern light')
      const act = render({ view: 'images', page: 'act', part: 'act1' }, summary({ edits }))
      const rows = [...act.querySelectorAll('tbody tr')]
      expect(text(rows[0])).toContain("Act I's style left out")
      expect(text(rows[1])).not.toContain('style left out')
    })
    it('is not there when the act adds no style', () => {
      const page = render(route, summary({ style: { ...style, parts: {} } }))
      expect(page.querySelector('.act-style-box')).toBeNull()
    })
    it('names the act’s style as the reason a picture is out of date', () => {
      const row = summary().images!.acts[0]!.rows[0]!
      const edits = { inn: { partStyle: null } }
      const page = render(route, summary({ edits, chosen: { inn: row.madeFrom } }))
      expect(text(page)).toContain("Out of date since it was chosen: Act I's style.")
    })
    it('ignores a second click while the first save is on its way, and keeps focus', async () => {
      let answer: (r: Response) => void = () => {}
      globalThis.fetch = ((path: string, init?: RequestInit) => {
        sent.push({ method: init?.method ?? 'GET', path, body: JSON.parse(String(init?.body)) })
        return new Promise<Response>((resolve) => (answer = resolve))
      }) as unknown as typeof fetch
      const page = render(route)
      box(page).focus()
      await act(async () => box(page).click())
      await act(async () => box(page).click())
      expect(sent).toHaveLength(1)
      await act(async () => answer(Response.json({ ok: true })))
      await act(async () => new Promise((r) => setTimeout(r, 20)))
      expect(sent.filter((r) => r.method === 'PATCH')).toHaveLength(1)
      expect(document.activeElement).toBe(box(page))
    })
    it('shows why a save failed under the box', async () => {
      globalThis.fetch = (async () =>
        Response.json(
          { ok: false, problems: [{ file: 'p.json', path: '', message: 'bad' }] },
          { status: 409 },
        )) as unknown as typeof fetch
      const page = render(route)
      await act(async () => box(page).click())
      await act(async () => new Promise((r) => setTimeout(r, 20)))
      expect(text(page.querySelector('.brief-panel'))).toContain('Could not be saved')
      expect(box(page).checked).toBe(true)
    })
  })

  it('says what is out of date', () => {
    const row = summary().images!.acts[0]!.rows[0]!
    const chosen = { inn: { ...row.madeFrom, words: 'x', width: 1 } }
    const page = render(route, summary({ chosen }))
    expect(text(page)).toContain('Out of date since it was chosen: the words and the size.')
    expect(text(page)).toContain('The game shows the chosen image until you choose another.')
  })

  it('compares the game’s new words with the user’s, and settles with either button', async () => {
    const edits = { inn: { text: 'cosy', gameWas: 'older' } }
    const page = render(route, summary({ edits }))
    const notice = page.querySelector('.images-compare')!
    expect(text(notice)).toContain(
      "The game changed this image's description since you wrote your own.",
    )
    expect(text(notice)).toContain('Your words (used now)')
    expect(text(notice)).toContain("The game's new words")
    expect(text(notice)).toContain('Before: older')
    const buttons = [...notice.querySelectorAll('button')].map((b) => b.textContent)
    expect(buttons).toEqual(["Use the game's", 'Keep mine'])
    await act(async () => button(page, 'Keep mine').click())
    await flush()
    expect(sent[0]).toEqual({
      method: 'POST',
      path: '/api/images/inn/compare',
      body: { choice: 'keep' },
    })
    expect(document.activeElement?.tagName).toBe('TEXTAREA')
  })

  it('also moves focus to the field after Use the game’s', async () => {
    const edits = { inn: { text: 'cosy', gameWas: 'older' } }
    const page = render(route, summary({ edits }))
    await act(async () => button(page, "Use the game's").click())
    await flush()
    expect(sent[0]).toEqual({
      method: 'POST',
      path: '/api/images/inn/compare',
      body: { choice: 'game' },
    })
    expect(document.activeElement?.tagName).toBe('TEXTAREA')
  })

  it('says why when settling fails', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch
    const edits = { inn: { text: 'cosy', gameWas: 'older' } }
    const page = render(route, summary({ edits }))
    await act(async () => button(page, 'Keep mine').click())
    // The failure arrives after the request and the mutation have both settled.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(text(page.querySelector('.images-compare .adopt-error'))).toBe('saving answered 500')
  })
})

describe('the Style page', () => {
  const route: ImagesRoute = { view: 'images', page: 'style' }

  it('holds the two fields, the palette and the acts’ additions', () => {
    const page = render(route)
    expect(text(page.querySelector('h1'))).toBe('Style')
    expect(text(page.querySelector('.page-header .muted'))).toBe(
      "Added to every image's prompt. The studio's own: change the look and what is kept out here.",
    )
    expect([...page.querySelectorAll('label')].map((l) => l.textContent)).toEqual([
      'The look',
      'Kept out of every image',
    ])
    expect(page.querySelector('.field-tag')).toBeNull()
    expect(text(page)).toContain('2 colours')
    expect(page.querySelectorAll('.images-swatch')).toHaveLength(2)
    expect(text(page)).toContain('Added per act')
    expect(text(page)).toContain(
      'The palette and the additions per act are changed in content-studio/images/edits.json.',
    )
    const rows = [...page.querySelectorAll('tbody tr')].map((r) => text(r))
    expect(rows).toEqual(['Act I: The Lanternlantern light', 'Act II: The Roadnothing'])
  })

  it('saves a style field when left', async () => {
    const page = render(route)
    const field = page.querySelector('textarea')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        field,
        'oil',
      )
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(sent[0]).toEqual({ method: 'PATCH', path: '/api/image-style', body: { look: 'oil' } })
  })

  it('never says Saved while a refused look is still on the page, and clears the refusal once a look saves', async () => {
    globalThis.fetch = (async (path: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, string | null>
      sent.push({ method: init?.method ?? 'GET', path, body })
      if ('look' in body && body.look === null)
        return Response.json(
          {
            ok: false,
            problems: [
              {
                file: 'content-studio/images/edits.json',
                path: 'style.look',
                message: 'the look cannot be empty',
              },
            ],
          },
          { status: 409 },
        )
      return Response.json({ ok: true })
    }) as unknown as typeof fetch
    const page = render(route)
    const [look, keepOut] = [...page.querySelectorAll('textarea')]
    const typeAndLeave = async (field: HTMLTextAreaElement, value: string) => {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
          field,
          value,
        )
        field.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => {
        field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      })
      await act(async () => new Promise((r) => setTimeout(r, 20)))
    }
    const panel = () => text(page.querySelector('.brief-panel'))
    await typeAndLeave(look!, '')
    expect(panel()).toContain('Could not be saved')
    await typeAndLeave(keepOut!, 'words')
    expect(sent.at(-1)?.body).toEqual({ keepOut: 'words' })
    expect(panel()).toContain('Could not be saved')
    expect(page.querySelector('.saved')).toBeNull()
    await typeAndLeave(look!, 'oil')
    expect(panel()).not.toContain('Could not be saved')
    expect(text(page.querySelector('.saved'))).toBe('Saved')
  })

  it('keeps the Added per act table to the panel, so it never scrolls the page sideways', () => {
    const page = render(route)
    const panel = [...page.querySelectorAll('section')].find((s) =>
      s.querySelector('h2')?.textContent?.includes('Added per act'),
    )!
    const table = panel.querySelector('table')!
    expect(table.closest('.table-box')).toBeNull()
    expect(minWidthsInEveryWindow(table)).toEqual([])
  })

  it('says when there is no style yet, and when the edits cannot be read', () => {
    const page = render(route, summary({ style: null }))
    expect(text(page)).toContain('There is no style yet')
    expect(text(page)).toContain(
      "Add one under style in content-studio/images/edits.json. Until then, each image's prompt is only its own words.",
    )
    expect(page.querySelector('textarea')).toBeNull()
    const unread = render(route, summary({ style: null, editsInvalid: true }))
    expect(text(unread)).toContain('The style cannot be read')
  })
})

describe('the game’s look', () => {
  const act = { view: 'images', page: 'act', part: 'act1' } as const
  const old = lookKey(lookOf({ ...style, palette: ['#000000'] }), { width: 320, height: 200 })
  const stale = () => {
    const first = summary().images!.acts[0]!.rows
    return summary({ chosen: { inn: first[0]!.madeFrom }, lookWas: old })
  }

  it('shows no notice and no tag while every picture has the game’s look', () => {
    const first = summary().images!.acts[0]!.rows
    const page = render(act, summary({ chosen: { inn: first[0]!.madeFrom } }))
    expect(page.querySelector('[aria-label="The game\'s look changed"]')).toBeNull()
    expect(text(page)).not.toContain('Old look')
  })

  it('says the look changed, tags the old images, and brings them all with one button', async () => {
    const page = render(act, stale())
    const notice = page.querySelector('[aria-label="The game\'s look changed"]')!
    expect(text(notice)).toBe(
      "The game's look changed (its palette). 1 image and its takes still have the old look. Nothing needs making again.Bring all to the new look",
    )
    expect(text(page.querySelector('.images-status'))).toContain('Old look')
    act_(() => button(page, 'Bring all to the new look').click())
    await flush()
    expect(sent.find((c) => c.path === '/api/images/bring-all')).toMatchObject({ method: 'POST' })
  })

  it('counts while it brings them, and carries on after a reload', () => {
    const run = { running: true, total: 14, done: 6, failed: [] }
    const page = render(act, stale(), {}, run)
    expect(text(page.querySelector('[role="status"]'))).toBe(
      'Bringing images to the new look… 6 of 14',
    )
    expect(button(page, 'Bring all to the new look')).toBeUndefined()
  })

  it('turns red with the count and the reason when some could not be brought, and offers Try again', async () => {
    const failed = Array.from({ length: 5 }, (_, i) => ({ id: `i${i}`, reason: 'missing' }))
    const page = render(act, stale(), {}, { running: false, total: 14, done: 14, failed })
    const notice = page.querySelector('.notice-err')!
    expect(text(notice)).toBe(
      "Brought 9 of 14 images to the new look. 5 couldn't be: the model's picture for each is missing. Their old look stays until you make new takes.Try again",
    )
    act_(() => button(page, 'Try again').click())
    await flush()
    expect(sent.find((c) => c.path === '/api/images/bring-all')).toMatchObject({ method: 'POST' })
  })

  it('puts a failure away once nothing is left with an old look', () => {
    const failed = [{ id: 'i', reason: 'missing' }]
    const first = summary().images!.acts[0]!.rows
    const page = render(
      act,
      summary({ chosen: { inn: first[0]!.madeFrom } }),
      {},
      { running: false, total: 2, done: 2, failed },
    )
    expect(page.querySelector('.notice-err')).toBeNull()
  })

  it('shows the look line and the Old look tag on the image’s page', () => {
    const page = render({ view: 'images', page: 'image', image: 'inn' }, stale())
    expect(text(page.querySelector('.images-look-line'))).toBe(
      "320 × 200 · the game's palette, 2 colours · patterned ditheringOld look",
    )
  })

  it('says the palette can’t be read in the look line while the style cannot be used', () => {
    const { images } = summarizeImages({
      parts: [{ id: 'act1', title: 'Act I' }],
      lists: [
        {
          id: 'act1',
          title: 'Act I',
          file: 'a1.json',
          state: { status: 'ok', images: [inn] },
          canRefresh: false,
        },
      ],
      editsFile: 'content-studio/images/edits.json',
      style: null,
      look: null,
      lookError: 'no',
      edits: {},
      chosen: { read: true, entries: {} },
    })
    const page = render({ view: 'images', page: 'image', image: 'inn' }, {
      images,
    } as unknown as ProjectSummary)
    expect(text(page.querySelector('.images-look-line'))).toBe(
      "320 × 200 · the game's palette — can't be read",
    )
  })
})

describe('an image the game lists in two acts', () => {
  const both = { style: { ...style, parts: { act1: 'lantern light', act2: 'dawn' } } }
  const shared = (over: Options = {}) => summary({ ...both, actTwoImages: [inn], ...over })
  const links = (node: Element | null | undefined) =>
    [...(node?.querySelectorAll('a') ?? [])].map((a) => [a.textContent, a.getAttribute('href')])

  it('names the other acts under the id on each act’s list, as links', () => {
    const one = render({ view: 'images', page: 'act', part: 'act1' }, shared())
    const row = one.querySelector('tbody tr')!
    expect(text(row.querySelector('td'))).toBe('The Inninnalso in Act II')
    expect(links(row.querySelector('.images-also'))).toEqual([['Act II', '#/images/parts/act2']])
    expect(row.querySelector('a.music-track-link')!.getAttribute('href')).toBe(
      '#/images/items/inn?from=act1',
    )
    const two = render({ view: 'images', page: 'act', part: 'act2' }, shared())
    expect(text(two.querySelector('.images-also'))).toBe('also in Act I')
  })
  it('shows the same making status on every act’s list', () => {
    for (const part of ['act1', 'act2']) {
      const page = render({ view: 'images', page: 'act', part }, shared(), {
        inn: { takes: 2, left: 2 },
      })
      expect(text(page.querySelector('.images-status'))).toContain('making 2 takes')
    }
  })
  it('goes back to the act it was opened from, and falls back to the first act', () => {
    const from = render({ view: 'images', page: 'image', image: 'inn', from: 'act2' }, shared())
    expect(text(from.querySelector('.crumbs'))).toBe('Images › Act II')
    const bare = render({ view: 'images', page: 'image', image: 'inn' }, shared())
    expect(text(bare.querySelector('.crumbs'))).toBe('Images › Act I')
    const wrong = render({ view: 'images', page: 'image', image: 'inn', from: 'act9' }, shared())
    expect(text(wrong.querySelector('.crumbs'))).toBe('Images › Act I')
  })
  it('says on its page that a change reaches the other acts', () => {
    const page = render({ view: 'images', page: 'image', image: 'inn', from: 'act2' }, shared())
    const line = page.querySelector('.images-shared')
    expect(text(line)).toBe('Shared with Act I: a change here changes it there too.')
    expect(links(line)).toEqual([['Act I', '#/images/parts/act1']])
  })
  describe('the act style menu', () => {
    const route: ImagesRoute = { view: 'images', page: 'image', image: 'inn', from: 'act2' }
    const menu = (page: HTMLElement) =>
      page.querySelector('select.act-style-menu') as HTMLSelectElement
    it('replaces the tick box with a menu of the acts that add a style, and None', () => {
      const page = render(route, shared())
      expect(page.querySelector('.act-style-box')).toBeNull()
      const label = [...page.querySelectorAll('label')].find((l) => l.htmlFor === menu(page).id)
      expect(text(label)).toBe('Act style for this image')
      expect([...menu(page).options].map((o) => o.textContent)).toEqual([
        "Act I's — lantern light",
        "Act II's — dawn",
        'None',
      ])
      expect(menu(page).value).toBe('act1')
      expect(text(page.querySelector('.images-act-style-note'))).toBe(
        "One act's style is used for this image in every act.",
      )
    })
    it('starts on None when the first act adds none, and leaves only the acts that add one', () => {
      const page = render(route, shared({ style: { ...style, parts: { act2: 'dawn' } } }))
      expect([...menu(page).options].map((o) => o.textContent)).toEqual(["Act II's — dawn", 'None'])
      expect(menu(page).value).toBe('')
    })
    it('says an act’s style is left out only on the list of an act that adds one', () => {
      const only = { ...style, parts: { act2: 'dawn' } }
      const one = render({ view: 'images', page: 'act', part: 'act1' }, shared({ style: only }))
      expect(text(one.querySelector('tbody tr'))).not.toContain('style left out')
      const two = render({ view: 'images', page: 'act', part: 'act2' }, shared({ style: only }))
      expect(text(two.querySelector('tbody tr'))).toContain("Act II's style left out")
    })
    it('has no menu when no act adds a style', () => {
      const page = render(route, shared({ style: { ...style, parts: {} } }))
      expect(page.querySelector('select.act-style-menu')).toBeNull()
      expect(page.querySelector('.act-style-box')).toBeNull()
    })
    it('saves a pick at once and says Saved', async () => {
      const page = render(route, shared())
      await act(async () => {
        menu(page).value = ''
        menu(page).dispatchEvent(new Event('change', { bubbles: true }))
      })
      await flush()
      expect(sent[0]).toEqual({
        method: 'PATCH',
        path: '/api/images/inn/act-style',
        body: { from: null },
      })
      expect(text(page.querySelector('.saved'))).toBe('Saved')
    })
    it('says why a save failed, under the menu', async () => {
      globalThis.fetch = (async () =>
        Response.json(
          { ok: false, problems: [{ file: 'p.json', path: '', message: 'bad' }] },
          { status: 409 },
        )) as unknown as typeof fetch
      const page = render(route, shared())
      await act(async () => {
        menu(page).value = 'act2'
        menu(page).dispatchEvent(new Event('change', { bubbles: true }))
      })
      await act(async () => new Promise((r) => setTimeout(r, 20)))
      expect(text(page.querySelector('.brief-panel'))).toContain('Could not be saved')
      expect(menu(page).value).toBe('act1')
    })
    it('names the acts in the out-of-date notice', () => {
      const row = shared().images!.acts[0]!.rows[0]!
      const chosen = { inn: row.madeFrom }
      const picked = summary({
        ...both,
        actTwoImages: [inn],
        chosen,
        edits: { inn: { partStyle: 'act2' } },
      })
      expect(text(render(route, picked))).toContain(
        "Out of date since it was chosen: Act II's style instead of Act I's.",
      )
      const none = summary({
        ...both,
        actTwoImages: [inn],
        chosen,
        edits: { inn: { partStyle: null } },
      })
      expect(text(render(route, none))).toContain(
        "Out of date since it was chosen: Act I's style left out.",
      )
    })
  })
})

describe('lists that disagree about an image', () => {
  const other = { ...inn, description: 'a tall inn' }
  const summed = () => summary({ actTwoImages: [other] })
  const sentence =
    "The game's lists disagree about this image: Act I and Act II give it different words. Fix them in the game, then Refresh from the game."

  it('keeps the row in place on every act, dimmed, with the reason and no link', () => {
    for (const part of ['act1', 'act2']) {
      const page = render({ view: 'images', page: 'act', part }, summed())
      const rows = [...page.querySelectorAll('tbody tr')]
      const row = rows.find((r) => r.textContent?.includes('The Inn'))!
      expect(row.className).toContain('images-row-off')
      expect(row.querySelector('a')).toBeNull()
      expect(text(row.querySelector('.images-prompt'))).toBe(sentence)
      expect(row.querySelector('.images-prompt .adopt-error')).not.toBeNull()
      expect(text(row.querySelector('.images-size'))).toBe('—')
      expect(text(row.querySelector('.images-status'))).toBe('lists disagree')
    }
    const first = render({ view: 'images', page: 'act', part: 'act1' }, summed())
    expect([...first.querySelectorAll('tbody tr')].map((r) => text(r.querySelector('td')))).toEqual(
      ['The Inninn', 'The Barnbarn'],
    )
  })
  it('counts an image the lists disagree about in the line under the act heading', () => {
    const page = render({ view: 'images', page: 'act', part: 'act2' }, summed())
    expect(text(page.querySelector('.page-header .muted'))).toBe(
      'The images the game asks for in Act II. 0 of 1 chosen.',
    )
  })

  it('shows only the reason on the page of such an image', () => {
    const page = render({ view: 'images', page: 'image', image: 'inn', from: 'act2' }, summed())
    expect(text(page.querySelector('.crumbs'))).toBe('Images › Act II')
    expect(text(page.querySelector('h1'))).toBe('The Inn')
    expect(text(page.querySelector('.page-header .mono'))).toBe('inn')
    expect(text(page.querySelector('.notice-err'))).toBe(sentence)
    expect(page.querySelector('.brief-panel')).toBeNull()
    expect(page.querySelector('textarea')).toBeNull()
  })
})

describe('what needs attention on an act’s images page', () => {
  const made = (id: string) => summary().images!.acts[0]!.rows.find((r) => r.id === id)!.madeFrom
  const names = (page: HTMLElement) =>
    [...page.querySelectorAll('tbody tr .images-name strong')].map((s) => s.textContent)

  it('counts the images up to date at the top, a link to the ones that need attention', () => {
    const page = render(
      { view: 'images', page: 'act', part: 'act1' },
      summary({ chosen: { inn: made('inn') } }),
    )
    const stat = page.querySelector<HTMLAnchorElement>('a.stat-lead')!
    expect(stat.getAttribute('href')).toBe('#/images/parts/act1?show=attention')
    expect(text(stat)).toBe('50%Images up to date1 / 21 needs attention ›')
  })

  it('lists only the images that need attention there, with the way back to all', () => {
    const page = render(
      { view: 'images', page: 'act', part: 'act1', show: 'attention' },
      summary({ chosen: { inn: made('inn') } }),
    )
    expect(names(page)).toEqual(['The Barn'])
    const all = [...page.querySelectorAll('a')].find((a) => a.textContent === 'Show all')!
    expect(all.getAttribute('href')).toBe('#/images/parts/act1')
    expect(text(page)).toContain('Showing the 1 image that needs attention.')
  })

  it('has no link when every image is up to date', () => {
    const page = render(
      { view: 'images', page: 'act', part: 'act1' },
      summary({ chosen: { inn: made('inn'), barn: made('barn') } }),
    )
    expect(page.querySelector('a.stat-lead')).toBeNull()
    expect(text(page.querySelector('.stat-lead'))).toBe('100%Images up to date2 / 2')
  })
})

describe('accepting what changed since an image’s take was chosen', () => {
  const route = { view: 'images', page: 'image', image: 'inn' } as const
  const made = () => summary().images!.acts[0]!.rows[0]!.madeFrom

  it('offers Accept for changed words or style, keeping the chosen picture', async () => {
    const calls: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      return Response.json({ ok: true })
    }) as typeof fetch
    cleanups.push(() => (globalThis.fetch = realFetch))
    const page = render(route, summary({ chosen: { inn: { ...made(), words: 'an old inn' } } }))
    const notice = page.querySelector('.notice-warn')!
    expect(text(notice)).toContain(
      'The game shows the chosen image until you choose another. Accept counts it as up to date as it is.',
    )
    await act(async () => button(page, 'Accept').click())
    expect(calls).toContain('POST /api/images/inn/accept')
  })

  it('offers no Accept when the size changed, and says it needs a new take', () => {
    const page = render(route, summary({ chosen: { inn: { ...made(), width: 16 } } }))
    const notice = page.querySelector('.notice-warn')!
    expect([...notice.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Accept')
    expect(text(notice)).toContain('A changed size needs a new take.')
  })
})

describe('the patches the game asks for', () => {
  const lamp = { id: 'lamp-lit', title: 'Lamp lit', description: 'Light the lamp' }
  const door = { id: 'door-ajar', title: 'Door ajar', description: 'Open the door' }
  const heading = (page: HTMLElement) => [...page.querySelectorAll('h2')].map((h) => text(h))

  it('puts a panel under the workbench, one pick for each patch', () => {
    const page = render(
      { view: 'images', page: 'image', image: 'inn', from: 'act1' },
      summary({ patches: [lamp, door] }),
    )
    expect(heading(page)).toEqual(['Prompt', 'Fine-tune the picture', 'Patches the game asks for'])
    expect(page.querySelectorAll('.patch-pick').length).toBe(2)
  })

  it('leaves the page as it is when the game asks for none', () => {
    const page = render({ view: 'images', page: 'image', image: 'inn', from: 'act1' })
    expect(page.querySelector('.game-patches')).toBeNull()
    expect(heading(page)).not.toContain('Patches the game asks for')
  })

  it('flags on the act’s list an image whose patch words changed under the user’s, and nothing else', () => {
    const edits = { inn: { patches: { 'lamp-lit': { text: 'Dim it', gameWas: 'Old' } } } }
    const flagged = render(
      { view: 'images', page: 'act', part: 'act1' },
      summary({ patches: [lamp, door], edits }),
    )
    const [inn, barn] = [...flagged.querySelectorAll('tbody tr')]
    expect(text(inn!.querySelector('.images-prompt .chg'))).toBe("the game changed a patch's words")
    expect(barn!.querySelector('.chg')).toBeNull()
    const mine = { inn: { patches: { 'lamp-lit': { text: 'Dim it', gameWas: 'Light the lamp' } } } }
    const settled = render(
      { view: 'images', page: 'act', part: 'act1' },
      summary({ patches: [lamp, door], edits: mine }),
    )
    expect(settled.querySelector('.chg')).toBeNull()
    expect(text(settled.querySelector('tbody tr'))).not.toContain('patch')
  })

  describe('patches to make again', () => {
    const actRoute = { view: 'images', page: 'act', part: 'act1' } as const
    const image = { view: 'images', page: 'image', image: 'inn', from: 'act1' } as const
    const settled = (over: Options = {}) =>
      summary({
        patches: [lamp, door],
        chosen: { inn: summary().images!.acts[0]!.rows[0]!.madeFrom },
        gameTake: 4,
        imageTakes: [1, 2, 4],
        ...over,
      })

    it('names them on the act’s row, in the game’s order, and changes no other figure', () => {
      const before = render(actRoute, settled({ choices: { 'lamp-lit': [4] } }))
      expect(before.querySelector('.images-prompt .chg')).toBeNull()
      const page = render(actRoute, settled({ choices: { 'lamp-lit': [2], 'door-ajar': [1] } }))
      const row = page.querySelector('tbody tr')!
      expect(text(row.querySelector('.images-prompt .chg'))).toBe('make again: Lamp lit, Door ajar')
      expect([...row.querySelectorAll('.images-status .chip')].map((c) => c.textContent)).toEqual([
        'chosen',
      ])
      expect(text(page.querySelector('.page-header .muted'))).toContain('1 of 2 chosen')
    })

    it('puts it after the line about the game’s changed words', () => {
      const edits = { inn: { patches: { 'lamp-lit': { text: 'Dim it', gameWas: 'Old' } } } }
      const page = render(actRoute, settled({ edits, choices: { 'door-ajar': [2] } }))
      expect(
        [...page.querySelectorAll('tbody tr')[0]!.querySelectorAll('.images-prompt .chg')].map(
          (c) => text(c),
        ),
      ).toEqual(["the game changed a patch's words", 'make again: Door ajar'])
    })

    it('marks the patch on the image’s page with a chip', () => {
      const edits = {
        inn: { patches: { 'lamp-lit': { text: 'Dim it', gameWas: 'Light the lamp' } } },
      }
      const page = render(image, settled({ edits, choices: { 'lamp-lit': [2] } }))
      const [first, second] = [...page.querySelectorAll('.patch-pick')]
      expect(first!.querySelector('.chip-warn')?.textContent).toBe('Make again')
      expect(second!.querySelector('.chip-warn')).toBeNull()
    })

    it('says, in a line above the words when opened, where it was chosen and how to get it back', () => {
      const page = render(image, settled({ choices: { 'lamp-lit': [1, 2] } }))
      act(() => page.querySelector<HTMLButtonElement>('.patch-pick')!.click())
      const line = page.querySelector('.game-patch-body .make-again-line')
      expect(text(line)).toBe(
        'Chosen on takes 1 and 2 of the image, so the game does not show it now. Make a new one here, or choose one of those takes again to bring it back.',
      )
    })

    it('has no chip or line once the patch has a chosen take on the take in the game', () => {
      const page = render(image, settled({ choices: { 'lamp-lit': [2, 4] } }))
      expect(page.querySelector('.patch-pick .chip-warn')).toBeNull()
    })
  })

  describe('chosen patches that overlap', () => {
    const actRoute = { view: 'images', page: 'act', part: 'act1' } as const
    const at = (x: number) => ({ x, y: 0, width: 10, height: 10 })
    const settled = (patchAreas: NonNullable<Options['patchAreas']>) =>
      summary({
        patches: [lamp, door],
        chosen: { inn: summary().images!.acts[0]!.rows[0]!.madeFrom },
        gameTake: 4,
        imageTakes: [4],
        choices: { 'lamp-lit': [4], 'door-ajar': [4] },
        patchAreas,
      })

    it('names the pair on the act’s row, and changes no figure', () => {
      const page = render(
        actRoute,
        settled({ 'lamp-lit': { 4: at(0) }, 'door-ajar': { 4: at(5) } }),
      )
      const row = page.querySelector('tbody tr')!
      expect(text(row.querySelector('.images-prompt .chg'))).toBe(
        'patches overlap: Lamp lit and Door ajar',
      )
      expect([...row.querySelectorAll('.images-status .chip')].map((c) => c.textContent)).toEqual([
        'chosen',
      ])
      expect(text(page.querySelector('.page-header .muted'))).toContain('1 of 2 chosen')
    })
    it('has no line when the areas only share a border', () => {
      const page = render(
        actRoute,
        settled({ 'lamp-lit': { 4: at(0) }, 'door-ajar': { 4: at(10) } }),
      )
      expect(page.querySelector('.images-prompt .chg')).toBeNull()
    })
  })

  it('says patches among the things the lists disagree on', () => {
    const page = render(
      { view: 'images', page: 'act', part: 'act1' },
      summary({ patches: [lamp], actTwoImages: [{ ...inn, description: 'x', patches: [] }] }),
    )
    expect(text(page.querySelector('.images-row-off .adopt-error'))).toBe(
      "The game's lists disagree about this image: Act I and Act II give it different words and patches. Fix them in the game, then Refresh from the game.",
    )
  })
})

describe('the named areas the game declares', () => {
  const fountain = { id: 'fountain', title: 'Fountain' }
  const notice = { id: 'old-notice', title: 'Old notice' }
  const lamp = { id: 'lamp-lit', title: 'Lamp lit', description: 'Light the lamp' }
  const image = { view: 'images', page: 'image', image: 'inn', from: 'act1' } as const
  const act = { view: 'images', page: 'act', part: 'act1' } as const
  const heading = (page: HTMLElement) => [...page.querySelectorAll('h2')].map((h) => text(h))
  const chosen = (page: HTMLElement) => text(page.querySelector('.page-header .muted'))
  const lineOf = (page: HTMLElement, at = 0) =>
    text([...page.querySelectorAll('tbody tr')][at]!.querySelector('.images-areas'))

  it('lists them on the image’s page below the workbench and the fine-tune panel, above the patches', () => {
    const page = render(image, summary({ areas: [fountain, notice], patches: [lamp] }))
    expect(heading(page)).toEqual([
      'Prompt',
      'Fine-tune the picture',
      'Patches the game asks for',
      'Named areas',
    ])
    expect(text(page.querySelector('.named-areas-head'))).toBe('Named areas · 0 of 2 placed')
    expect([...page.querySelectorAll('.named-area')].map((r) => text(r))).toEqual([
      'FountainfountainTo place',
      'Old noticeold-noticeTo place',
    ])
  })
  it('keeps one panel when the page is drawn again with new data (siblings need their own keys)', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, enabled: false } },
    })
    client.setQueryData(['image-making'], {})
    client.setQueryData(['look-run'], null)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    cleanups.push(() => act_(() => root.unmount()))
    const draw = (shown: ProjectSummary) =>
      act_(() =>
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            createElement(ImagesView, { summary: shown, route: image }),
          ),
        ),
      )
    draw(summary({ areas: [fountain, notice], patches: [lamp] }))
    draw(summary({ areas: [fountain, notice], patches: [lamp] }))
    expect(container.querySelectorAll('.named-areas').length).toBe(1)
    expect(container.querySelectorAll('.game-patches').length).toBe(1)
  })
  it('leaves the page as it is when the game names none', () => {
    const page = render(image)
    expect(page.querySelector('.named-areas')).toBeNull()
    expect(heading(page)).not.toContain('Named areas')
  })
  it('says on the act’s list how many are left, under the status, and counts nothing else', () => {
    const page = render(act, summary({ areas: [fountain, notice] }))
    expect(lineOf(page)).toBe('2 of 2 areas to place')
    expect(page.querySelectorAll('tbody tr')[1]!.querySelector('.images-areas')).toBeNull()
    expect(page.querySelector('.images-status .images-areas')).not.toBeNull()
    const none = render(act, summary())
    expect(none.querySelector('.images-areas')).toBeNull()
    const box = { x: 1, y: 1, width: 10, height: 10 }
    const some = render(
      act,
      summary({ areas: [fountain, notice], edits: { inn: { areas: { fountain: box } } } }),
    )
    expect(lineOf(some)).toBe('1 of 2 areas to place')
    expect(chosen(page)).toBe(chosen(none))
    expect(chosen(page)).toContain('chosen')
  })
  it('says one area in the singular, and keeps the line under the making chip', () => {
    const page = render(act, summary({ areas: [fountain] }), { inn: { takes: 2, left: 1 } })
    expect(lineOf(page)).toBe('1 of 1 area to place')
    const status = page.querySelector('.images-status')!
    expect(status.querySelector('.chip')).not.toBeNull()
    expect(status.lastElementChild!.className).toContain('images-areas')
  })
  it('says named areas among the things the lists disagree on, and shows no line for it', () => {
    const page = render(
      act,
      summary({ areas: [fountain], actTwoImages: [{ ...inn, description: 'x', areas: [] }] }),
    )
    expect(text(page.querySelector('.images-row-off .adopt-error'))).toBe(
      "The game's lists disagree about this image: Act I and Act II give it different words and named areas. Fix them in the game, then Refresh from the game.",
    )
    expect(page.querySelector('.images-areas')).toBeNull()
  })
})

describe('the jobs of an image’s page', () => {
  const fountain = { id: 'fountain', title: 'Fountain' }
  const lamp = { id: 'lamp-lit', title: 'Lamp lit', description: 'Light the lamp' }
  const image = { view: 'images', page: 'image', image: 'inn', from: 'act1' } as const
  const tabsOf = (page: HTMLElement) => [...page.querySelectorAll('[role="tab"]')]
  const names = (page: HTMLElement) =>
    tabsOf(page).map((t) => text(t.querySelector('.job-tab-title')))
  const shown = (page: HTMLElement) =>
    [...page.querySelectorAll('h2')].filter((h) => !h.closest('[hidden]')).map((h) => text(h))
  const press = (key: string, init: KeyboardEventInit = {}, on: EventTarget = document.body) =>
    act(() => {
      on.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
    })

  it('shows the tabs under the title and only the open job, which is Make', () => {
    const page = render(image, summary({ areas: [fountain], patches: [lamp] }))
    expect(names(page)).toEqual(['Make', 'Fine-tune', 'Patches', 'Named areas'])
    expect(tabsOf(page).map((t) => text(t.querySelector('.job-tab-key')))).toEqual([
      '1',
      '2',
      '3',
      '4',
    ])
    expect(tabsOf(page).map((t) => t.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ])
    expect(shown(page)).toEqual(['Prompt'])
  })

  it('opens a job by its tab, and its tab keeps its chip', () => {
    const page = render(image, summary({ areas: [fountain], patches: [lamp] }))
    act(() => tabsOf(page)[3]!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(shown(page)).toEqual(['Named areas'])
    expect(text(tabsOf(page)[3]!.querySelector('.chip'))).toBe('0 of 1')
    expect(text(tabsOf(page)[0]!.querySelector('.chip'))).toBe('No take chosen')
  })

  it('has no tab for a job the game does not ask for, and the keys follow the tabs shown', () => {
    const page = render(image, summary({ areas: [fountain] }))
    expect(names(page)).toEqual(['Make', 'Fine-tune', 'Named areas'])
    press('3')
    expect(shown(page)).toEqual(['Named areas'])
    press('4')
    expect(shown(page)).toEqual(['Named areas'])
  })

  it('switches with 1 to 4, but not while typing, in a menu, or with Command, Control or Option', () => {
    const page = render(image, summary({ areas: [fountain], patches: [lamp] }))
    press('2')
    expect(shown(page)).toEqual(['Fine-tune the picture'])
    press('1', { metaKey: true })
    press('1', { ctrlKey: true })
    press('1', { altKey: true })
    expect(shown(page)).toEqual(['Fine-tune the picture'])
    press('3')
    expect(shown(page)).toEqual(['Patches the game asks for'])
  })

  it('does not switch while a menu is focused, but does while a box is', () => {
    const page = render(image, summary({ areas: [fountain] }))
    const menu = document.createElement('div')
    menu.setAttribute('role', 'listbox')
    const option = document.createElement('button')
    menu.append(option)
    page.append(menu)
    press('3', {}, option)
    expect(shown(page)).toEqual(['Prompt'])
    const box = document.createElement('input')
    box.type = 'checkbox'
    page.append(box)
    press('3', {}, box)
    expect(shown(page)).toEqual(['Named areas'])
  })

  it('does not switch when the key is pressed in a field', () => {
    const page = render(image, summary({ areas: [fountain] }))
    const field = page.querySelector('textarea')!
    press('3', {}, field)
    expect(shown(page)).toEqual(['Prompt'])
  })

  it('opens on Make when the page is opened again', () => {
    const first = render(image, summary({ areas: [fountain] }))
    press('2')
    expect(shown(first)).toEqual(['Fine-tune the picture'])
    expect(shown(render(image, summary({ areas: [fountain] })))).toEqual(['Prompt'])
  })

  it('says "making…" on the chip of a tab that is not open while its takes are made', () => {
    const page = render(image, summary(), { inn: { takes: 1, left: 30 } }, null, false, {
      making: [{ n: 1, model: 'klein', left: 30 }] as unknown as ImageTakesView['making'],
    })
    act(() => tabsOf(page)[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(text(tabsOf(page)[0]!.querySelector('.chip'))).toBe('making…')
    act(() => tabsOf(page)[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(text(tabsOf(page)[0]!.querySelector('.chip'))).toBe('No take chosen')
  })

  it('keeps the unseen fine-tunes unseen while Make is open, and shows how many in the chip', async () => {
    const asked: string[] = []
    const real = globalThis.fetch
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      asked.push(`${init?.method ?? 'GET'} ${url}`)
      return Response.json({ ok: true })
    }) as typeof fetch
    cleanups.push(() => (globalThis.fetch = real))
    const tune = (n: number) => ({ n, words: 'w', area: null, model: 'klein', isNew: true })
    const page = render(image, summary(), {}, null, false, undefined, (client) =>
      client.setQueryData(['image-fine-tunes', 'inn'], {
        ok: true,
        picture: { kind: 'take', n: 1, width: 320, height: 200 },
        maker: { ok: true },
        models: {},
        tunes: [tune(1), tune(2)],
        making: [],
        failed: [],
        failedModels: [],
      }),
    )
    await flush()
    expect(asked.filter((a) => a.includes('/seen'))).toEqual([])
    expect(text(tabsOf(page)[1]!.querySelector('.chip'))).toBe('2 new')
  })

  it('opens Make to focus the words after settling the game’s words from another tab', async () => {
    const changed = summary({ edits: { inn: { text: 'mine', gameWas: 'old' } } })
    const page = render(image, changed)
    press('2')
    expect(shown(page)).toEqual(['Fine-tune the picture'])
    await act(async () => button(page, 'Keep mine').click())
    await flush()
    expect(shown(page)).toEqual(['Prompt'])
    expect(document.activeElement?.tagName).toBe('TEXTAREA')
  })

  it('does not take the Take keys in another tab', async () => {
    const asked: string[] = []
    const real = globalThis.fetch
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      asked.push(`${init?.method ?? 'GET'} ${url}`)
      return Response.json({ ok: true })
    }) as typeof fetch
    cleanups.push(() => (globalThis.fetch = real))
    const page = render(image, summary({ areas: [fountain] }))
    press('3')
    expect(shown(page)).toEqual(['Named areas'])
    press('c')
    press('d')
    await flush()
    expect(asked.filter((a) => a.startsWith('POST') || a.startsWith('DELETE'))).toEqual([])
  })
})
