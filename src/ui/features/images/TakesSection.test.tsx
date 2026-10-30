import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ImageRow } from '../../../core/images'
import type { ImageTakeView, ImageTakesView } from '../../../core/imageTakes'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { TakesSection } = await import('./TakesSection')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
const realFetch = globalThis.fetch
afterEach(() => {
  cleanups.splice(0).forEach((c) => c())
  globalThis.fetch = realFetch
})
afterAll(() => GlobalRegistrator.unregister())

const row: ImageRow = {
  id: 'inn',
  title: 'Inn',
  partId: 'act1',
  description: 'a low inn',
  width: 320,
  height: 200,
  words: 'a low inn',
  changed: false,
  gameChanged: false,
  gameWas: null,
  prompt: 'a low inn',
  chosenTake: null,
  gameFile: null,
  madeFrom: { words: 'a low inn', style: '', width: 320, height: 200 },
  status: 'none yet',
  reasons: [],
}

const take = (n: number, over: Partial<ImageTakeView> = {}): ImageTakeView => ({
  n,
  width: 1024,
  height: 640,
  earlier: false,
  chosen: false,
  isNew: false,
  ...over,
})

const view = (over: Partial<ImageTakesView> = {}): ImageTakesView => ({
  ok: true,
  generator: { ok: true },
  takes: [],
  making: [],
  failed: [],
  lockUnread: false,
  ...over,
})

/** Shows the section with this view, and records what the page asks the server. */
async function show(data: ImageTakesView, over: Partial<ImageRow> = {}) {
  const calls: { url: string; method: string; body: unknown }[] = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    return Response.json({ ok: true })
  }) as typeof fetch
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(['image-takes', 'inn'], data)
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
        createElement(TakesSection, { row: { ...row, ...over } }),
      ),
    ),
  )
  await act(async () => {})
  const buttons = (text: string) =>
    [...container.querySelectorAll('button')].filter((b) => b.textContent === text)
  const button = (text: string) => {
    const found = buttons(text)[0]
    if (!found) throw new Error(`no button "${text}"`)
    return found
  }
  const click = (el: Element) =>
    act(async () => {
      ;(el as HTMLElement).click()
    })
  const key = (name: string, target: Element = container.querySelector('section')!) =>
    act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }))
    })
  const text = () => container.textContent ?? ''
  /** The take on the right, from the heading of its side. */
  const right = () => container.querySelector('[data-side="right"] b')?.textContent
  const left = () => container.querySelector('[data-side="left"] b')?.textContent
  return { client, container, calls, buttons, button, click, key, text, right, left }
}

const three = [take(1), take(2), take(3)]

describe('the Takes section’s empty states', () => {
  it('nothing chosen and no takes: two empty frames and the first make button beneath', async () => {
    const s = await show(view())
    expect(s.text()).toContain('Nothing shows here yet')
    expect(s.text()).toContain('Choose a take and the game shows it.')
    expect(s.text()).toContain('No takes yet')
    expect(s.text()).toContain('Each take is a new image made from the prompt.')
    expect(s.text()).toContain('Make a few, compare them, and choose the one the game shows.')
    expect(s.buttons('Make 2 takes')).toHaveLength(1)
    await s.click(s.button('Make 2 takes'))
    expect(s.calls.at(-1)).toMatchObject({
      url: '/api/images/inn/takes',
      method: 'POST',
      body: { count: 2 },
    })
  })

  it('a chosen take and no others: the right says so, and there is no strip', async () => {
    const s = await show(view({ takes: [take(2, { chosen: true })] }), {
      chosenTake: 2,
      status: 'chosen',
    })
    expect(s.left()).toBe('Take 2')
    expect(s.text()).toContain('chosen')
    expect(s.text()).toContain(
      'No other takes yet — make a few more to compare with the chosen one.',
    )
    expect(s.text()).not.toContain('Press a take')
    expect(s.buttons('Make 2 more takes')).toHaveLength(1)
  })

  it('the game’s own image shows with its path, until a take is chosen', async () => {
    const s = await show(view(), { gameFile: { file: 'web/inn.png', exists: true } })
    expect(s.text()).toContain('The game’s own image'.replace('’', "'"))
    expect(s.text()).toContain('web/inn.png')
    expect(s.text()).toContain('Choose a take and the game shows it instead.')
    expect(s.container.querySelector('img')?.getAttribute('src')).toBe('/api/images/inn/current')
  })
})

describe('comparing takes', () => {
  it('puts the newest take on the right, leaves the others in the strip, and Choose chooses it', async () => {
    const s = await show(view({ takes: three }))
    expect(s.right()).toBe('Take 3')
    expect(s.text()).toContain('Press a take, or use ← →, to put it beside the chosen one.')
    await s.click(s.button('Choose'))
    expect(s.calls.at(-1)).toMatchObject({ url: '/api/images/inn/choose', body: { n: 3 } })
  })

  it('does not list the chosen take in the strip, and marks earlier words', async () => {
    const s = await show(
      view({ takes: [take(1, { earlier: true }), take(2, { chosen: true }), take(3)] }),
      { chosenTake: 2, status: 'chosen' },
    )
    const thumbs = [...s.container.querySelectorAll('[data-strip] button')]
    expect(thumbs.map((t) => t.textContent)).toEqual(['Take 1earlier words', 'Take 3'])
    expect(s.left()).toBe('Take 2')
  })

  it('shows "new" on a take not yet shown on the right, and marks the one on the right seen', async () => {
    const s = await show(view({ takes: [take(1, { isNew: true }), take(2, { isNew: true })] }))
    const thumbs = [...s.container.querySelectorAll('[data-strip] button')]
    expect(thumbs[0]!.textContent).toContain('new')
    expect(s.calls.map((c) => c.url)).toContain('/api/images/inn/takes/2/seen')
    expect(s.calls.map((c) => c.url)).not.toContain('/api/images/inn/takes/1/seen')
  })

  it('a press on the strip, or ← and →, puts a take on the right', async () => {
    const s = await show(view({ takes: three }))
    const thumbs = () => [...s.container.querySelectorAll<HTMLButtonElement>('[data-strip] button')]
    await s.click(thumbs()[0]!)
    expect(s.right()).toBe('Take 1')
    expect(thumbs()[0]!.getAttribute('aria-pressed')).toBe('true')
    await s.key('ArrowRight')
    expect(s.right()).toBe('Take 2')
    await s.key('ArrowLeft')
    await s.key('ArrowLeft')
    expect(s.right()).toBe('Take 1')
  })

  it('leaves the arrow keys to the count menu', async () => {
    const s = await show(view({ takes: three }))
    await s.key('ArrowLeft', s.container.querySelector('select')!)
    expect(s.right()).toBe('Take 3')
  })

  it('Choose moves the take left and brings the one chosen before to the right, marked "was chosen"', async () => {
    const s = await show(view({ takes: [take(1), take(2, { chosen: true }), take(3)] }), {
      chosenTake: 2,
      status: 'chosen',
    })
    await s.click(s.container.querySelector<HTMLButtonElement>('[data-strip] button')!)
    expect(s.right()).toBe('Take 1')
    await s.click(s.button('Choose'))
    expect(s.calls.at(-1)).toMatchObject({ body: { n: 1 } })
    expect(s.right()).toBe('Take 2')
    const thumbs = [...s.container.querySelectorAll('[data-strip] button')]
    expect(thumbs.some((t) => t.textContent?.includes('was chosen'))).toBe(true)
  })

  it('stops a poll that is on its way before showing a choice, so it cannot undo it', async () => {
    const s = await show(view({ takes: [take(1), take(2, { chosen: true }), take(3)] }), {
      chosenTake: 2,
    })
    const cancelled: unknown[] = []
    const real = s.client.cancelQueries.bind(s.client)
    s.client.cancelQueries = ((filters: unknown) => {
      cancelled.push(filters)
      return real(filters as never)
    }) as typeof s.client.cancelQueries
    await s.click(s.button('Choose'))
    expect(cancelled).toEqual([{ queryKey: ['image-takes', 'inn'] }])
    await s.click(s.button('Drop'))
    expect(cancelled).toHaveLength(2)
  })

  it('keeps the arrow keys from also scrolling the strip', async () => {
    const s = await show(view({ takes: three }))
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      s.container.querySelector('[data-strip] button')!.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
  })

  it('Drop removes the take on the right at once, and the next one comes to the right', async () => {
    const s = await show(view({ takes: three }))
    await s.click(s.container.querySelector<HTMLButtonElement>('[data-strip] button')!)
    await s.click(s.button('Drop'))
    expect(s.calls.at(-1)).toMatchObject({ url: '/api/images/inn/takes/1', method: 'DELETE' })
    expect(s.right()).toBe('Take 2')
  })
})

describe('un-choosing', () => {
  const chosen = () =>
    show(view({ takes: [take(2, { chosen: true })] }), { chosenTake: 2, status: 'chosen' })

  it('asks first, with the exact words, and Cancel changes nothing', async () => {
    const s = await chosen()
    await s.click(s.button('Un-choose'))
    expect(s.text()).toContain('Un-choose take 2?')
    expect(s.text()).toContain(
      'The game shows no image here until you choose another. Take 2 stays among the takes.',
    )
    await s.click(s.button('Cancel'))
    expect(s.calls).toHaveLength(0)
    expect(s.text()).not.toContain('Un-choose take 2?')
    expect(document.activeElement?.textContent).toBe('Un-choose')
  })

  it('un-chooses on the second Un-choose', async () => {
    const s = await chosen()
    await s.click(s.button('Un-choose'))
    await s.click(s.button('Un-choose'))
    expect(s.calls.at(-1)).toMatchObject({ url: '/api/images/inn/unchoose', method: 'POST' })
  })
})

describe('making takes', () => {
  const making = [
    { n: 4, state: 'making' as const, elapsed: 10, expected: 60 },
    { n: 5, state: 'waiting' as const, elapsed: 0, expected: 60 },
  ]

  it('shows each take in the strip at once, with Stop, and the menus wait', async () => {
    const s = await show(view({ takes: [take(1), take(2)], making }))
    expect(s.text()).toContain('making · about 1 min left')
    expect(s.text()).toContain('waiting')
    expect(s.container.querySelectorAll('[role="progressbar"]')).toHaveLength(2)
    expect(s.button('Stop').disabled).toBe(false)
    expect(s.container.querySelector<HTMLSelectElement>('select')!.disabled).toBe(true)
    expect(s.button('Make 2 more takes').disabled).toBe(true)
    await s.click(s.button('Stop'))
    expect(s.calls.at(-1)).toMatchObject({ url: '/api/images/inn/stop', method: 'POST' })
  })

  it('does not move the right side when a take finishes', async () => {
    const first = await show(view({ takes: [take(1)] }))
    expect(first.right()).toBe('Take 1')
    const s = await show(view({ takes: [take(1), take(2, { isNew: true })] }))
    await s.click(s.container.querySelector<HTMLButtonElement>('[data-strip] button')!)
    expect(s.right()).toBe('Take 1')
    expect(s.container.textContent).toContain('new')
  })

  it('the count menu offers 1 to 4 takes, starts at 2 and names the button', async () => {
    const s = await show(view({ takes: [take(1)] }))
    const options = [...s.container.querySelectorAll('select option')]
    expect(options.map((o) => o.textContent)).toEqual(['1 take', '2 takes', '3 takes', '4 takes'])
    expect(s.container.querySelector<HTMLSelectElement>('select')!.value).toBe('2')
  })
})

describe('what can go wrong', () => {
  it('a take that failed says why, keeps the others, and Try again asks for the same number', async () => {
    const s = await show(
      view({
        takes: [take(1)],
        failed: [{ n: 7, message: 'The image generator: out of memory.' }],
      }),
    )
    expect(s.text()).toContain('Take 7 could not be made.')
    expect(s.text()).toContain('The image generator: out of memory. Your other takes are kept.')
    await s.click(s.button('Try again'))
    expect(s.calls.at(-1)).toMatchObject({ body: { retry: 7 } })
    const alone = await show(view({ failed: [{ n: 1, message: 'It broke.' }] }))
    expect(alone.text()).not.toContain('Your other takes are kept.')
  })

  it('when images cannot be made, it says so and links Setup, but takes can still be chosen and dropped', async () => {
    const s = await show(
      view({
        generator: { ok: false, message: 'mflux is not on the PATH', fix: 'uv tool install mflux' },
        takes: three,
      }),
    )
    expect(s.text()).toContain('Images can’t be made yet.'.replace('’', "'"))
    expect(s.text()).toContain('The image model is not installed. Setup says what is missing.')
    expect(s.container.querySelector('a')?.getAttribute('href')).toBe('#/setup')
    expect(s.button('Make 2 more takes').disabled).toBe(true)
    expect(s.container.querySelector<HTMLSelectElement>('select')!.disabled).toBe(true)
    expect(s.button('Choose').disabled).toBe(false)
    expect(s.button('Drop').disabled).toBe(false)
  })

  it('while the lock cannot be read, nothing is chosen, dropped or un-chosen', async () => {
    const s = await show(view({ takes: [take(1, { chosen: true }), take(2)], lockUnread: true }), {
      chosenTake: 1,
    })
    expect(s.button('Choose').disabled).toBe(true)
    expect(s.button('Drop').disabled).toBe(true)
    expect(s.button('Un-choose').disabled).toBe(true)
  })

  it('shows only the latest action’s refusal', async () => {
    const s = await show(view({ takes: three }))
    globalThis.fetch = (async (_url: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? Response.json({ ok: true })
        : Response.json(
            { ok: false, message: 'No choosing now.' },
            { status: 409 },
          )) as unknown as typeof fetch
    await s.click(s.button('Choose'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(s.text()).toContain('No choosing now.')
    await s.click(s.button('Drop'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(s.text()).not.toContain('No choosing now.')
  })

  it('shows a refusal under the buttons', async () => {
    const s = await show(view({ takes: three }))
    globalThis.fetch = (async () =>
      Response.json(
        { ok: false, message: 'That take is gone.' },
        { status: 409 },
      )) as unknown as typeof fetch
    await s.click(s.button('Drop'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(s.text()).toContain('That take is gone.')
  })
})
