import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { FineTunesView } from '../../../core/imageFineTunes'
import type { ImageRow } from '../../../core/images'
import { valuesInEveryWindow } from '../../../../test/stylesheet'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const isOff = (element: Element) => element.getAttribute('aria-disabled') === 'true'
const { act, createElement } = await import('react')
const { WhyTip } = await import('../../components/WhyTip')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { FineTunePanel } = await import('./FineTunePanel')
const { JobOpenProvider } = await import('./ImageJobTabs')
const { IMAGES_LOCK_WHY } = await import('../../imagesText')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
const realFetch = globalThis.fetch
afterEach(() => {
  cleanups.splice(0).forEach((c) => c())
  globalThis.fetch = realFetch
})
afterAll(() => GlobalRegistrator.unregister())

const tune = (n: number, over: Partial<FineTunesView['tunes'][number]> = {}) => ({
  n,
  words: 'Add a cat',
  area: null,
  model: 'klein' as const,
  isNew: false,
  ...over,
})

const view = (over: Partial<FineTunesView> = {}): FineTunesView => ({
  ok: true,
  picture: { kind: 'take', n: 3, width: 1024, height: 576 },
  maker: { ok: true },
  models: { 'qwen-edit': 'whole', klein: 'whole' },
  tunes: [],
  making: [],
  failed: [],
  failedModels: [],
  ...over,
})

/** Renders the panel of image `inn` over a server answering `current()` and every change `posted`. */
async function render(
  current: () => FineTunesView,
  posted: { status: number; body: unknown } = { status: 200, body: { ok: true } },
  takes: () => unknown = () => ({}),
  open = true,
) {
  const sent: { method: string; path: string; body: unknown }[] = []
  globalThis.fetch = (async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET')
      return Response.json(
        String(path).endsWith('/fine-tunes')
          ? current()
          : String(path).endsWith('/takes')
            ? takes()
            : {},
      )
    sent.push({
      method,
      path: String(path),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
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
        createElement(
          JobOpenProvider,
          { value: open },
          createElement(FineTunePanel, {
            row: { id: 'inn', width: 1024, height: 576 } as ImageRow,
          }),
        ),
      ),
    )
  })
  await settle()
  cleanups.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  return { host, sent, client }
}

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
async function type(box: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    set.call(box, value)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const wordsBox = (host: Element) => host.querySelector<HTMLTextAreaElement>('textarea')!
const cards = (host: Element) => [...host.querySelectorAll<HTMLElement>('.fine-card')]

describe('the states of the panel', () => {
  it('says only that there is no picture when there is none', async () => {
    const { host } = await render(() => view({ picture: { kind: 'none' } }))
    expect(text(host)).toBe(
      "Fine-tune the picture There's no picture to fine-tune yet. Make takes and choose one, then change it here.",
    )
    expect(host.querySelector('textarea')).toBeNull()
  })

  it('shows the picture, the form and no fine-tunes yet, with Make off until there are words', async () => {
    const { host } = await render(() => view())
    expect(host.querySelector('h2')?.textContent).toBe('Fine-tune the picture')
    expect(text(host)).toContain('In the game · Take 3')
    expect(text(host)).toContain('No fine-tunes yet. Describe a change and make a few.')
    expect(text(host)).toContain(
      'Drag on the picture to change only part of it; with no mark the whole picture is changed.',
    )
    expect(wordsBox(host).placeholder).toBe('Say what to add, remove or change')
    expect(isOff(button(host, 'Make 4 fine-tunes')!)).toBe(true)
    await type(wordsBox(host), 'Add a black cat')
    expect(isOff(button(host, 'Make 4 fine-tunes')!)).toBe(false)
    expect(host.querySelectorAll('select.takes-count option')).toHaveLength(10)
  })

  it('fits a portrait picture to the window’s height, so its buttons and the strip stay in view', async () => {
    const { host } = await render(() =>
      view({ picture: { kind: 'take', n: 3, width: 160, height: 200 } }),
    )
    const stage = host.querySelector<HTMLElement>('.patch-stage')!
    expect(stage.style.getPropertyValue('--picture-ratio')).toBe(String(160 / 200))
    const widths = valuesInEveryWindow(stage, 'width')
    expect(widths.at(-1)).toMatch(/^\.patch-stage: min\(100%, .*vh.*var\(--picture-ratio, 1\)\)\)$/)
  })

  it('names the game’s own image when no take is chosen', async () => {
    const { host } = await render(() =>
      view({ picture: { kind: 'game', width: 1024, height: 576 } }),
    )
    expect(text(host)).toContain("In the game · the game's own image")
    expect(host.querySelector('img.patch-take')?.getAttribute('src')).toBe(
      '/api/images/inn/fine-tunes/base',
    )
  })

  it('keeps Make off, with the line under the menu, when the model is not on this computer', async () => {
    const { host } = await render(() =>
      view({ models: { 'qwen-edit': 'absent', klein: 'absent' } }),
    )
    await type(wordsBox(host), 'Add a cat')
    expect(isOff(button(host, 'Make 4 fine-tunes')!)).toBe(true)
    expect(text(host)).toContain('Setup says how to download it.')
  })
})

describe('making fine-tunes', () => {
  it('asks for the words, the count, the model and no area', async () => {
    const { host, sent } = await render(() => view())
    await type(wordsBox(host), 'Add a black cat')
    await act(async () => button(host, 'Make 4 fine-tunes')!.click())
    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/api/images/inn/fine-tunes',
        body: { count: 4, words: 'Add a black cat', area: null, model: 'klein' },
      },
    ])
  })

  it('marks an area by dragging, says so, asks with it, and clears it', async () => {
    const { host, sent } = await render(() => view())
    await drag(stageOf(host), [100, 50], [300, 250])
    expect(host.querySelector('.patch-mark')).not.toBeNull()
    await type(wordsBox(host), 'Add a cat')
    await act(async () => button(host, 'Make 4 fine-tunes')!.click())
    expect(sent[0]!.body).toMatchObject({ area: { x: 100, y: 50, width: 200, height: 200 } })
    await act(async () => button(host, 'Clear the mark')!.click())
    expect(host.querySelector('.patch-mark')).toBeNull()
    expect(button(host, 'Clear the mark')).toBeUndefined()
  })

  it('shows what is being made or waiting, with a time left, and Stop stops them all', async () => {
    const { host, sent } = await render(() =>
      view({
        making: [
          { n: 1, state: 'making', elapsed: 5, expected: 25, model: 'klein' },
          { n: 2, state: 'waiting', elapsed: 0, expected: 25, model: 'klein' },
        ],
      }),
    )
    expect(text(host)).toContain('Being made… Fine-tune 1 · making, about 20 s left')
    expect(text(host)).toContain('Waiting Fine-tune 2 · waiting')
    expect(host.querySelector('[role=progressbar]')).not.toBeNull()
    await act(async () => button(host, 'Stop')!.click())
    expect(sent[0]).toMatchObject({ method: 'POST', path: '/api/images/inn/fine-tunes/stop' })
  })

  it('puts Stop under the card being made, which stops only that one; waiting cards have no buttons', async () => {
    const { host, sent } = await render(() =>
      view({
        making: [
          { n: 1, state: 'making', elapsed: 5, expected: 25, model: 'klein' },
          { n: 2, state: 'waiting', elapsed: 0, expected: 25, model: 'klein' },
        ],
      }),
    )
    const makingCard = host.querySelector('.patch-thumb-making')!
    expect(text(makingCard.querySelector('.patch-making-pic')!)).toBe('Being made…')
    expect(
      text(host.querySelectorAll('.patch-thumb-making')[1]!.querySelector('.patch-making-pic')!),
    ).toBe('Waiting')
    expect(text(makingCard)).toBe('Being made… Fine-tune 1 · making, about 20 s left Stop')
    expect(host.querySelectorAll('.patch-thumb-making button')).toHaveLength(1)
    await act(async () => makingCard.querySelector('button')!.click())
    expect(sent[0]).toMatchObject({ method: 'DELETE', path: '/api/images/inn/fine-tunes/1' })
    // The shared Stop beside Make fine-tunes still stops them all.
    await act(async () => button(host.querySelector('.patch-make')!, 'Stop')!.click())
    expect(sent[1]).toMatchObject({ method: 'POST', path: '/api/images/inn/fine-tunes/stop' })
  })

  it('moves focus to the words box after a card’s Stop when nothing is left', async () => {
    const { host } = await render(() =>
      view({ making: [{ n: 1, state: 'making', elapsed: 5, expected: 25, model: 'klein' }] }),
    )
    await act(async () =>
      host.querySelector<HTMLButtonElement>('.patch-thumb-making button')!.click(),
    )
    await settle()
    expect(document.activeElement).toBe(host.querySelector('textarea'))
  })

  it('shows a failed one with its reason and makes it again, or drops it', async () => {
    const { host, sent } = await render(() =>
      view({
        failed: [
          {
            n: 4,
            message: 'FLUX.2 klein ran out of memory.',
            words: 'x',
            area: null,
            model: 'klein',
          },
        ],
      }),
    )
    expect(text(host)).toContain('Fine-tune 4 FLUX.2 klein ran out of memory.')
    await act(async () => button(host, 'Try again')!.click())
    expect(sent[0]!.body).toEqual({ retry: 4 })
    await act(async () => button(host, 'Drop')!.click())
    expect(sent[1]).toMatchObject({ method: 'DELETE', path: '/api/images/inn/fine-tunes/4' })
  })
})

describe('the form', () => {
  it('has its labels above its fields, the model label visible', async () => {
    const { host } = await render(() => view())
    const form = host.querySelector('.fine-tools')!
    const labels = [...form.querySelectorAll('.lbl')].map((l) => text(l))
    expect(labels).toEqual(['What to change', 'Model for new takes'])
    const box = form.querySelector('textarea')!
    expect(box.closest('label')!.firstElementChild!.className).toContain('lbl')
  })

  it('grows the words box with the words', async () => {
    const { host } = await render(() => view())
    const box = host.querySelector('textarea')!
    Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => 180 })
    await type(box, 'a very long description '.repeat(20))
    expect(box.style.height).toBe('180px')
  })
})

describe('the card Stop and the words box, in detail', () => {
  it('keeps the height the person dragged the box to', async () => {
    const { host } = await render(() => view())
    const box = host.querySelector('textarea')!
    Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => 180 })
    Object.defineProperty(box, 'clientHeight', { configurable: true, get: () => 400 })
    box.style.height = '400px'
    await type(box, 'short')
    expect(box.style.height).toBe('400px')
  })

  it('moves focus to the next fine-tune being made after a card’s Stop', async () => {
    let dropped = false
    const { host } = await render(() =>
      view({
        making: dropped
          ? [{ n: 2, state: 'making', elapsed: 1, expected: 25, model: 'klein' }]
          : [
              { n: 1, state: 'making', elapsed: 5, expected: 25, model: 'klein' },
              { n: 2, state: 'waiting', elapsed: 0, expected: 25, model: 'klein' },
            ],
      }),
    )
    dropped = true
    await act(async () =>
      host.querySelector<HTMLButtonElement>('.patch-thumb-making button')!.click(),
    )
    await settle()
    expect(document.activeElement).toBe(host.querySelector('.patch-thumb-making button'))
  })
})

/** Looks at the fine-tune on card `i` and presses Choose. */
async function choose(host: Element, i: number) {
  await act(async () => cards(host)[i]!.querySelector('button')!.click())
  await act(async () => button(host, 'Choose C')!.click())
}

describe('looking at, dropping and using fine-tunes', () => {
  const ready = () => view({ tunes: [tune(1), tune(2, { isNew: true }), tune(3)] })

  it('shows each as a card, new ones with the chip, and lays one over the picture when pressed', async () => {
    const { host } = await render(ready)
    expect(cards(host).map((c) => text(c))).toEqual([
      'Fine-tune 1',
      'Fine-tune 2 new',
      'Fine-tune 3',
    ])
    // The newest is looked at to begin with.
    expect(text(host)).toContain('with Fine-tune 3 over it')
    await act(async () => cards(host)[0]!.querySelector('button')!.click())
    expect(text(host)).toContain('with Fine-tune 1 over it')
    expect(host.querySelector('img.patch-over')?.getAttribute('src')).toBe(
      '/api/images/inn/fine-tunes/1',
    )
    expect(cards(host)[0]!.dataset.looking).toBe('true')
  })

  it('records that one has been looked at', async () => {
    const { sent } = await render(() => view({ tunes: [tune(1, { isNew: true })] }))
    expect(sent).toEqual([
      { method: 'POST', path: '/api/images/inn/fine-tunes/1/seen', body: null },
    ])
  })

  it('steps with the arrow keys, turns the fine-tune off and on with S, and drops with D', async () => {
    const { host, sent } = await render(ready)
    const pick = cards(host)[1]!.querySelector('button')!
    await act(async () => pick.click())
    await key(pick, 'ArrowRight')
    expect(text(host)).toContain('with Fine-tune 3 over it')
    await key(pick, 'ArrowLeft')
    await key(pick, 'ArrowLeft')
    expect(text(host)).toContain('with Fine-tune 1 over it')
    expect(host.querySelector('img.patch-over')).not.toBeNull()
    await key(pick, 's')
    expect(host.querySelector('img.patch-over')).toBeNull()
    await key(pick, 's')
    await key(pick, 'd')
    expect(sent.filter((s) => s.method === 'DELETE')).toEqual([
      { method: 'DELETE', path: '/api/images/inn/fine-tunes/1', body: null },
    ])
  })

  it('uses one at once, says what came along, empties the words, and Close puts the line away', async () => {
    const { host, sent } = await render(ready, {
      status: 200,
      body: { ok: true, take: 4, from: 3, carried: { areas: 3, patches: 1 } },
    })
    await type(wordsBox(host), 'leftover words')
    await choose(host, 1)
    await settle()
    expect(sent.filter((s) => s.path.endsWith('/use'))).toEqual([
      { method: 'POST', path: '/api/images/inn/fine-tunes/use', body: { n: 2 } },
    ])
    expect(text(host.querySelector('[role=status]'))).toBe(
      'Take 4 is in the game now. Its 3 named areas and 1 chosen patch came along from Take 3. Close',
    )
    expect(wordsBox(host).value).toBe('')
    expect(document.activeElement).not.toBe(wordsBox(host))
    await act(async () => button(host, 'Close')!.click())
    expect(host.querySelector('[role=status]')).toBeNull()
  })

  it('keeps the came-along line on the new take, and puts it away when another take is chosen', async () => {
    let served = ready()
    const { host, client } = await render(() => served, {
      status: 200,
      body: { ok: true, take: 4, from: 3, carried: { areas: 3, patches: 1 } },
    })
    await choose(host, 1)
    await settle()
    const follow = async (n: number) => {
      served = view({ picture: { kind: 'take', n, width: 1024, height: 576 } })
      await act(async () => {
        await client.invalidateQueries({ queryKey: ['image-fine-tunes', 'inn'] })
      })
      await settle()
    }
    await follow(4)
    expect(host.querySelector('[role=status]')).not.toBeNull()
    await follow(2)
    expect(host.querySelector('[role=status]')).toBeNull()
    await follow(3)
    expect(host.querySelector('[role=status]')).toBeNull()
  })

  it('says why when a use is refused, and keeps the fine-tunes', async () => {
    const { host } = await render(ready, {
      status: 409,
      body: { ok: false, message: 'The images lock could not be read.' },
    })
    await choose(host, 1)
    await settle()
    expect(text(host)).toContain('The images lock could not be read.')
    expect(cards(host)).toHaveLength(3)
  })
})

describe('a late click meant for Stop', () => {
  const making = [
    { n: 1, state: 'making' as const, elapsed: 5, expected: 25, model: 'klein' as const },
  ]
  const finish = async (client: {
    invalidateQueries: (o: { queryKey: string[] }) => Promise<void>
  }) => {
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['image-fine-tunes', 'inn'] })
    })
    await settle()
  }
  const JUST = 'Just finished — a moment…'

  it('keeps Choose and Drop off for one second on a card that turns ready, then turns them on', async () => {
    let served = view({ making })
    const { host, sent, client } = await render(() => served, {
      status: 200,
      body: { ok: true, take: 4, from: 3, carried: { areas: 0, patches: 0 } },
    })
    served = view({ tunes: [tune(1)], making: [] })
    await finish(client)
    const buttons = [button(host, 'Choose C')!, button(host, 'Drop D')!]
    expect(buttons.map(isOff)).toEqual([true, true])
    expect(buttons.map((b) => b.getAttribute('data-why'))).toEqual([JUST, JUST])
    await act(async () => buttons[0]!.click())
    await key(buttons[0]!, 'd')
    expect(sent).toEqual([])
    await act(async () => await new Promise((r) => setTimeout(r, 1050)))
    expect(buttons.map(isOff)).toEqual([false, false])
    await act(async () => buttons[0]!.click())
    await settle()
    expect(sent).toMatchObject([{ path: '/api/images/inn/fine-tunes/use', body: { n: 1 } }])
  })

  it('gives each card its own second, and leaves cards ready at load on', async () => {
    let served = view({ tunes: [tune(1)], making: [{ ...making[0]!, n: 2 }] })
    const { host, client } = await render(() => served)
    expect(isOff(button(host, 'Choose C')!)).toBe(false)
    served = view({ tunes: [tune(1), tune(2)], making: [] })
    await finish(client)
    // Fine-tune 1 is the one looked at, and was ready at load; Fine-tune 2 has just turned ready.
    expect(isOff(button(host, 'Choose C')!)).toBe(false)
    await act(async () => cards(host)[1]!.querySelector('button')!.click())
    expect(isOff(button(host, 'Choose C')!)).toBe(true)
    await act(async () => cards(host)[0]!.querySelector('button')!.click())
    expect(isOff(button(host, 'Choose C')!)).toBe(false)
  })

  it('turns a card on at its own second', async () => {
    let served = view({ making: [making[0]!, { ...making[0]!, n: 2 }] })
    const { host, client } = await render(() => served)
    served = view({ tunes: [tune(1)], making: [{ ...making[0]!, n: 2 }] })
    await finish(client)
    await act(async () => await new Promise((r) => setTimeout(r, 400)))
    served = view({ tunes: [tune(1), tune(2)], making: [] })
    await finish(client)
    const chooseOff = () => isOff(button(host, 'Choose C')!)
    await act(async () => cards(host)[1]!.querySelector('button')!.click())
    expect(chooseOff()).toBe(true)
    await act(async () => await new Promise((r) => setTimeout(r, 750)))
    // Card 1's second is over, card 2 finished 400 ms later and is still settling.
    expect(chooseOff()).toBe(true)
    await act(async () => cards(host)[0]!.querySelector('button')!.click())
    expect(chooseOff()).toBe(false)
    await act(async () => cards(host)[1]!.querySelector('button')!.click())
    await act(async () => await new Promise((r) => setTimeout(r, 400)))
    expect(chooseOff()).toBe(false)
  })

  it('does nothing on Enter in the dimmed second', async () => {
    let served = view({ making })
    const { host, sent, client } = await render(() => served)
    served = view({ tunes: [tune(1)], making: [] })
    await finish(client)
    await key(button(host, 'Choose C')!, 'Enter')
    expect(sent).toEqual([])
  })
})

/** An image's takes, as the page reads them: `chain` lists [n, fine-tuned from, words]. */
const takesView = (
  chosen: number | null,
  chain: [number, number | null | undefined, string?][],
  over: Record<string, unknown> = {},
) => ({
  ok: true,
  generator: { ok: true },
  projectModel: 'klein',
  models: [],
  making: [],
  failed: [],
  lockUnread: false,
  lookError: null,
  takes: chain.map(([n, from, words]) => ({
    n,
    width: 1024,
    height: 576,
    model: 'klein',
    earlier: false,
    chosen: n === chosen,
    isNew: false,
    look: 'ready',
    cropped: false,
    ...(from !== undefined ? { fineTunedFrom: { take: from, words: words ?? '' } } : {}),
  })),
  ...over,
})
const steps = (host: Element) =>
  [...host.querySelectorAll('.history-step')].map((step) => text(step))
const CHAIN: [number, number | null | undefined, string?][] = [
  [3, undefined],
  [7, 3, 'Add a rowing boat by the pier'],
  [8, 7, 'Light the lighthouse lamp'],
]

describe('the screen: Choose, the count and the keys', () => {
  const ready = () =>
    view({
      picture: { kind: 'take', n: 8, width: 1024, height: 576 },
      tunes: [tune(1), tune(2, { isNew: true })],
    })

  it('has Choose, Drop and Before / after under the picture, and no Use this', async () => {
    const { host } = await render(ready)
    expect(button(host, 'Use this')).toBeUndefined()
    expect(button(host, 'Choose C')).toBeDefined()
    expect(button(host, 'Drop D')).toBeDefined()
    expect(button(host, 'Before / after S')).toBeDefined()
    expect(text(host.querySelector('.fine-strip'))).toContain('Fine-tunes')
  })

  it('counts 1 to 10, starting at 4, and says so on the button', async () => {
    const { host } = await render(() => view())
    expect(host.querySelectorAll('select.takes-count option')).toHaveLength(10)
    expect(host.querySelector<HTMLSelectElement>('select.takes-count')!.value).toBe('4')
    expect(button(host, 'Make 4 fine-tunes')).toBeDefined()
    await type(wordsBox(host), 'Add a cat')
    await act(async () => button(host, 'Make 4 fine-tunes')!.click())
  })

  it('writes the hint and the heading "What to change"', async () => {
    const { host } = await render(() => view())
    expect(text(host)).toContain(
      'Drag on the picture to change only part of it; with no mark the whole picture is changed.',
    )
    expect(text(host)).toContain('What to change')
  })

  it('chooses with C and drops with D, S flicks, ← → step, with focus anywhere', async () => {
    const { host, sent } = await render(ready, {
      status: 200,
      body: { ok: true, take: 9, from: 8, carried: { areas: 0, patches: 0 } },
    })
    await settle()
    await act(async () => await new Promise((r) => setTimeout(r, 1050)))
    await key(document.body, 'ArrowLeft')
    expect(host.querySelector('img.patch-over')?.getAttribute('src')).toBe(
      '/api/images/inn/fine-tunes/1',
    )
    await key(document.body, 's')
    expect(host.querySelector('img.patch-over')).toBeNull()
    await key(document.body, 's')
    await key(document.body, 'c')
    await settle()
    expect(sent.filter((s) => s.path.endsWith('/use'))).toEqual([
      { method: 'POST', path: '/api/images/inn/fine-tunes/use', body: { n: 1 } },
    ])
    await key(document.body, 'd')
    expect(sent.at(-1)).toMatchObject({ method: 'DELETE', path: '/api/images/inn/fine-tunes/2' })
  })

  it('undoes with Z right after a choose, without clicking out of the words box', async () => {
    const { host, sent } = await render(
      ready,
      { status: 200, body: { ok: true, take: 9, from: 8, carried: { areas: 0, patches: 0 } } },
      () => takesView(8, CHAIN),
    )
    await settle()
    await act(async () => await new Promise((r) => setTimeout(r, 1050)))
    await key(document.body, 'c')
    await settle()
    expect(document.activeElement).not.toBe(wordsBox(host))
    await key(document.activeElement ?? document.body, 'z')
    await settle()
    expect(sent.filter((s) => s.path === '/api/images/inn/choose')).toEqual([
      { method: 'POST', path: '/api/images/inn/choose', body: { n: 7 } },
    ])
  })

  it('hears no key while its tab is not the open one', async () => {
    const { sent } = await render(ready, undefined, undefined, false)
    await key(document.body, 'd')
    await key(document.body, 'c')
    expect(sent.filter((s) => s.method !== 'POST' || !s.path.endsWith('/seen'))).toEqual([])
  })

  it('leaves the keys alone while typing, and with Command held', async () => {
    const { host, sent } = await render(ready)
    await key(wordsBox(host), 'd')
    await act(async () =>
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'd', metaKey: true, bubbles: true }),
      ),
    )
    expect(sent.filter((s) => s.method === 'DELETE')).toEqual([])
  })
})

describe('History and Undo', () => {
  const picture = (n: number) => ({ kind: 'take' as const, n, width: 1024, height: 576 })

  it('lists the chain oldest first as a line of steps, the one in the game marked', async () => {
    const { host } = await render(
      () => view({ picture: picture(8) }),
      undefined,
      () => takesView(8, CHAIN),
    )
    expect(text(host.querySelector('.history')!.previousElementSibling)).toBe('History')
    expect(steps(host)).toEqual([
      'Take 3 · made from the prompt',
      'Take 7 · “Add a rowing boat by the pier”',
      'Take 8 · in the game · “Light the lighthouse lamp”',
    ])
    expect(host.querySelector('.history-step[data-now="true"]')).not.toBeNull()
    expect(button(host, 'Undo: back to Take 7 Z')).toBeDefined()
  })

  it('chooses the earlier take with Undo and with Z, as an ordinary choose', async () => {
    const { host, sent } = await render(
      () => view({ picture: picture(8) }),
      undefined,
      () => takesView(8, CHAIN),
    )
    await act(async () => button(host, 'Undo: back to Take 7 Z')!.click())
    await settle()
    expect(sent).toEqual([{ method: 'POST', path: '/api/images/inn/choose', body: { n: 7 } }])
    await key(document.body, 'z')
    await settle()
    expect(sent[1]).toEqual({ method: 'POST', path: '/api/images/inn/choose', body: { n: 7 } })
  })

  it('puts the came-along line away when Undo chooses another take', async () => {
    let served = view({ picture: picture(3), tunes: [tune(1)] })
    let chosen = 3
    const { host, client } = await render(
      () => served,
      { status: 200, body: { ok: true, take: 4, from: 3, carried: { areas: 0, patches: 0 } } },
      () =>
        takesView(chosen, [
          [3, undefined],
          [4, 3, 'Put a loaf on the table'],
        ]),
    )
    await choose(host, 0)
    await settle()
    expect(text(host.querySelector('[role=status]'))).toContain('Take 4 is in the game now.')
    served = view({ picture: picture(4), tunes: [tune(1)] })
    chosen = 4
    await act(async () => {
      await client.invalidateQueries()
    })
    await settle()
    served = view({ picture: picture(3), tunes: [tune(1)] })
    chosen = 3
    await act(async () => button(host, 'Undo: back to Take 3 Z')!.click())
    await settle()
    expect(host.querySelector('[role=status]')).toBeNull()
  })

  it('names no stale take after C chooses and Z undoes, the views following the server', async () => {
    let chosen = 1
    const { host } = await render(
      () => view({ picture: picture(chosen), tunes: [tune(1)] }),
      { status: 200, body: { ok: true, take: 6, from: 1, carried: { areas: 0, patches: 0 } } },
      () =>
        takesView(chosen, [
          [1, undefined],
          [6, 1, 'Add a cat'],
        ]),
    )
    await act(async () => cards(host)[0]!.querySelector('button')!.click())
    chosen = 6
    await key(document.body, 'c')
    await settle()
    expect(text(host.querySelector('[role=status]'))).toContain('Take 6 is in the game now.')
    chosen = 1
    await key(document.body, 'z')
    await settle()
    expect(steps(host)[0]).toContain('Take 1 · in the game')
    expect(text(host.querySelector('[role=status]'))).not.toContain('Take 6 is in the game now.')
  })

  it('puts the came-along line away when the source take is chosen elsewhere, after the new take was shown', async () => {
    let served = view({ picture: picture(3), tunes: [tune(1)] })
    const { host, client } = await render(() => served, {
      status: 200,
      body: { ok: true, take: 4, from: 3, carried: { areas: 0, patches: 0 } },
    })
    await choose(host, 0)
    await settle()
    const follow = async (n: number) => {
      served = view({ picture: picture(n), tunes: [tune(1)] })
      await act(async () => {
        await client.invalidateQueries({ queryKey: ['image-fine-tunes', 'inn'] })
      })
      await settle()
    }
    await follow(4)
    expect(host.querySelector('[role=status]')).not.toBeNull()
    await follow(3)
    expect(host.querySelector('[role=status]')).toBeNull()
  })

  it('keeps the steps after the one in the game, dimmed, and clicking one chooses it', async () => {
    const { host, sent } = await render(
      () => view({ picture: picture(7) }),
      undefined,
      () => takesView(7, CHAIN),
    )
    const later = host.querySelectorAll<HTMLElement>('.history-step')[2]!
    expect(later.dataset.after).toBe('true')
    await act(async () => later.querySelector('button')!.click())
    await settle()
    expect(sent[0]).toMatchObject({ path: '/api/images/inn/choose', body: { n: 8 } })
  })

  it('has one step and no Undo for a take made from the prompt', async () => {
    const { host } = await render(
      () => view({ picture: picture(3) }),
      undefined,
      () => takesView(3, [[3, undefined]]),
    )
    expect(steps(host)).toEqual(['Take 3 · in the game · made from the prompt'])
    expect(button(host, 'Undo: back to Take 3 Z')).toBeUndefined()
    expect(text(host)).not.toContain('Undo')
  })

  it('shows the game’s own image as its one step when no take is chosen', async () => {
    const { host } = await render(
      () => view({ picture: { kind: 'game', width: 1024, height: 576 } }),
      undefined,
      () => takesView(null, [[1, undefined]]),
    )
    expect(steps(host)).toEqual(["The game's own image"])
  })

  it('turns the steps and Undo off while the style needs fixing, with the reason', async () => {
    const { host, sent } = await render(
      () => view({ picture: picture(8) }),
      undefined,
      () => takesView(8, CHAIN, { lookError: 'The style is broken.' }),
    )
    const undo = button(host, 'Undo: back to Take 7 Z')!
    expect(isOff(undo)).toBe(true)
    expect(undo.getAttribute('data-why')).toBe(
      'The style needs fixing first. Fix it to choose this take.',
    )
    await act(async () => undo.click())
    await key(document.body, 'z')
    expect(sent).toEqual([])
  })

  it('says nothing yet while the takes do not have the chosen take', async () => {
    const { host } = await render(
      () => view({ picture: picture(9) }),
      undefined,
      () => takesView(8, CHAIN),
    )
    expect(host.querySelector('.history')).toBeNull()
    expect(text(host)).not.toContain("The game's own image")
  })

  it('turns Choose, the steps and Undo off with the lock unreadable, with its reason', async () => {
    const { host, sent } = await render(
      () => view({ picture: picture(8), tunes: [tune(1)] }),
      undefined,
      () => takesView(8, CHAIN, { lockUnread: true }),
    )
    await act(async () => await new Promise((r) => setTimeout(r, 50)))
    const off = [button(host, 'Choose C')!, button(host, 'Undo: back to Take 7 Z')!]
    expect(off.map(isOff)).toEqual([true, true])
    expect(off[1]!.getAttribute('data-why')).toBe(IMAGES_LOCK_WHY)
    await act(async () => off[1]!.click())
    await key(document.body, 'z')
    await key(document.body, 'c')
    expect(sent).toEqual([])
  })

  it('turns the steps off while a choose is being saved', async () => {
    const { host, sent } = await render(
      () => view({ picture: picture(8) }),
      undefined,
      () => takesView(8, CHAIN),
    )
    // The save of the first choose does not answer until it is let go.
    const fast = globalThis.fetch
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    globalThis.fetch = (async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') await held
      return fast(path, init)
    }) as typeof fetch
    await act(async () => button(host, 'Undo: back to Take 7 Z')!.click())
    await key(document.body, 'z')
    await act(async () => button(host, 'Undo: back to Take 7 Z')!.click())
    release()
    await settle()
    expect(sent.filter((s) => s.path.endsWith('/choose'))).toHaveLength(1)
  })
})
