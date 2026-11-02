import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ImagesRoute } from '../../route'
import type { MadeFrom, Prompts, GameStyle } from '../../../core/images'
import type { ProjectSummary } from '../../../core/summary'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const act_ = act
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { summarizeImages } = await import('../../../core/images')
const { lookKey, lookOf } = await import('../../../core/imageLook')
const { ImagesView } = await import('./ImagesView')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
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

const style: GameStyle = {
  look: 'flat pixel art',
  keepOut: 'text',
  palette: ['#000000', '#ffffff'],
  acts: { act1: 'lantern light' },
}
const inn = { id: 'inn', title: 'The Inn', description: 'a low inn', width: 320, height: 200 }
const barn = { id: 'barn', title: 'The Barn', description: 'a barn', width: 160, height: 100 }

interface Options {
  prompts?: Prompts
  chosen?: Record<string, MadeFrom>
  seen?: GameStyle | null
  style?: GameStyle | null
  actTwo?: 'missing' | 'empty'
  /** The images Act II lists (overrides `actTwo`). */
  actTwoImages?: (typeof inn)[]
  /** What the chosen pictures were brought to; the look now when absent. */
  lookWas?: string
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
        state: { status: 'ok', images: [inn, barn] },
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
    styleFile: 'style.json',
    style: options.style === undefined ? style : options.style,
    prompts: options.prompts ?? { images: {}, style: {} },
    chosen: Object.fromEntries(
      Object.entries(options.chosen ?? {}).map(([id, made]) => [
        id,
        {
          ...made,
          look: options.lookWas ?? lookKey(lookOf(style), id === 'inn' ? inn : barn),
        },
      ]),
    ),
    look: lookOf(style),
    seen: options.seen === undefined ? style : options.seen,
  })
  return { images } as unknown as ProjectSummary
}

function render(
  route: ImagesRoute,
  shown: ProjectSummary = summary(),
  making: Record<string, { takes: number; left: number }> = {},
  run: unknown = null,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(['image-making'], making)
  client.setQueryData(['look-run'], run)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
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
      "Every prompt ends with the game's style, and for Act I: lantern light. Style ›",
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
      "Every prompt ends with the game's style. Style ›",
    )
    expect(text(page)).toContain('The game asks for no images in Act II.')
    const none = render(
      { view: 'images', page: 'act', part: 'act1' },
      summary({ style: null, seen: null }),
    )
    expect(none.querySelector('.images-style-line')).toBeNull()
  })

  it('shows the takes being made in an image’s status, as Music does', () => {
    const page = render({ view: 'images', page: 'act', part: 'act1' }, summary(), {
      inn: { takes: 2, left: 50 },
    })
    const rows = [...page.querySelectorAll('tbody tr')]
    expect(text(rows[0]!.querySelector('.images-status'))).toBe('making 2 takes · about 1 min')
    expect(text(rows[1]!.querySelector('.images-status'))).toBe('none yet')
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
    const prompts: Prompts = {
      images: {
        inn: { words: 'cosy', gameWas: 'older' },
        barn: { words: 'red barn', gameWas: 'a barn' },
      },
      style: {},
    }
    const rows = [
      ...render(
        { view: 'images', page: 'act', part: 'act1' },
        summary({ prompts }),
      ).querySelectorAll('tbody tr'),
    ]
    expect(text(rows[0])).toContain("changed here · the game's words changed too")
    expect(text(rows[1])).toContain('changed here')
    expect(text(rows[1])).not.toContain('too')
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
    const prompts: Prompts = { images: { inn: { words: 'cosy', gameWas: 'a low inn' } }, style: {} }
    const page = render(route, summary({ prompts }))
    expect(text(page.querySelector('.field-tag'))).toBe("changed here · use the game's")
    expect(text(page)).toContain("The game's words: a low inn")
    await act(async () => button(page, "use the game's").click())
    expect(sent[0]).toEqual({ method: 'PATCH', path: '/api/images/inn', body: { words: null } })
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
      const prompts: Prompts = { images: {}, style: {}, actStyleOff: ['inn'] }
      const page = render(route, summary({ prompts }))
      expect(box(page).checked).toBe(false)
      expect(page.querySelector('.act-style-box .act-style-off')).not.toBeNull()
      expect(text(page.querySelector('.images-whole pre'))).not.toContain('lantern light')
      const act = render({ view: 'images', page: 'act', part: 'act1' }, summary({ prompts }))
      const rows = [...act.querySelectorAll('tbody tr')]
      expect(text(rows[0])).toContain("Act I's style left out")
      expect(text(rows[1])).not.toContain('style left out')
    })
    it('is not there when the act adds no style', () => {
      const page = render(route, summary({ style: { ...style, acts: {} } }))
      expect(page.querySelector('.act-style-box')).toBeNull()
    })
    it('names the act’s style as the reason a picture is out of date', () => {
      const row = summary().images!.acts[0]!.rows[0]!
      const prompts: Prompts = { images: {}, style: {}, actStyleOff: ['inn'] }
      const page = render(route, summary({ prompts, chosen: { inn: row.madeFrom } }))
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
    const prompts: Prompts = { images: { inn: { words: 'cosy', gameWas: 'older' } }, style: {} }
    const page = render(route, summary({ prompts }))
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
    const prompts: Prompts = { images: { inn: { words: 'cosy', gameWas: 'older' } }, style: {} }
    const page = render(route, summary({ prompts }))
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
    const prompts: Prompts = { images: { inn: { words: 'cosy', gameWas: 'older' } }, style: {} }
    const page = render(route, summary({ prompts }))
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
      "Added to every image's prompt. From the game's style file; your changes stay in the studio.",
    )
    expect([...page.querySelectorAll('label')].map((l) => l.textContent)).toEqual([
      'The look',
      'Kept out of every image',
    ])
    expect(text(page)).toContain('2 colours · set by the game')
    expect(page.querySelectorAll('.images-swatch')).toHaveLength(2)
    expect(text(page)).toContain('Added per act')
    expect(text(page)).toContain('Set by the game.')
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

  it('says when the game has no style file yet', () => {
    const page = render(route, summary({ style: null, seen: null }))
    expect(text(page)).toContain('The game has no style file yet')
    expect(text(page)).toContain("Until it has one, each image's prompt is only its own words.")
  })
})

describe('the game’s style changed', () => {
  const changed = (): ProjectSummary => {
    const row = summary().images!.acts[0]!.rows[0]!
    return summary({
      style: { ...style, look: 'watercolour' },
      seen: style,
      chosen: { inn: row.madeFrom },
    })
  }

  it('shows one notice on every Images page, with what changed', () => {
    for (const route of [
      { view: 'images', page: 'act', part: 'act1' },
      { view: 'images', page: 'style' },
      { view: 'images', page: 'image', image: 'inn' },
    ] as const) {
      const page = render(route, changed())
      const notice = page.querySelector('.notice')!
      expect(text(notice)).toContain("The game's style changed.")
      expect(text(notice)).toContain(
        '1 chosen image across all acts was made with the old style and is out of date.',
      )
      expect(text(notice)).toContain('Changed: the look.')
    }
  })

  it('is put away by Seen, which moves focus to the heading', async () => {
    const page = render({ view: 'images', page: 'act', part: 'act1' }, changed())
    await act(async () => button(page, 'Seen').click())
    await flush()
    expect(sent[0]).toEqual({ method: 'POST', path: '/api/image-style/seen', body: {} })
    expect(document.activeElement?.tagName).toBe('H1')
  })

  it('keeps focus on the heading when Seen takes the notice away with it', async () => {
    // Earlier tests leave their pages (and focus) behind: start from this page alone.
    document.body.replaceChildren()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    cleanups.push(() => act(() => root.unmount()))
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, enabled: false } },
    })
    client.setQueryData(['image-making'], {})
    client.setQueryData(['look-run'], null)
    const show = (shown: ProjectSummary) =>
      act(() =>
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            createElement(ImagesView, {
              summary: shown,
              route: { view: 'images', page: 'act', part: 'act1' },
            }),
          ),
        ),
      )
    show(changed())
    // The studio answers, and the page now shows the project without the notice.
    globalThis.fetch = (async () => {
      show(summary())
      return Response.json({ ok: true })
    }) as unknown as typeof fetch
    expect(document.activeElement).toBe(document.body)
    await act(async () => button(container, 'Seen').click())
    await flush()
    expect(container.querySelector('.notice')).toBeNull()
    expect(document.activeElement).toBe(container.querySelector('h1'))
  })

  it('is not shown when nothing changed', () => {
    expect(render({ view: 'images', page: 'style' }).querySelector('.notice')).toBeNull()
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
      styleFile: 'style.json',
      style: null,
      look: null,
      lookError: 'no',
      prompts: { images: {}, style: {} },
      chosen: {},
      seen: null,
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
  const both = { style: { ...style, acts: { act1: 'lantern light', act2: 'dawn' } } }
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
      const page = render(
        route,
        shared({
          style: { ...style, acts: { act2: 'dawn' } },
          seen: { ...style, acts: { act2: 'dawn' } },
        }),
      )
      expect([...menu(page).options].map((o) => o.textContent)).toEqual(["Act II's — dawn", 'None'])
      expect(menu(page).value).toBe('')
    })
    it('has no menu when no act adds a style', () => {
      const bare = { ...style, acts: {} }
      const page = render(route, shared({ style: bare, seen: bare }))
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
        prompts: { images: {}, style: {}, actStyleFrom: { inn: 'act2' } },
      })
      expect(text(render(route, picked))).toContain(
        "Out of date since it was chosen: Act II's style instead of Act I's.",
      )
      const none = summary({
        ...both,
        actTwoImages: [inn],
        chosen,
        prompts: { images: {}, style: {}, actStyleOff: ['inn'] },
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
