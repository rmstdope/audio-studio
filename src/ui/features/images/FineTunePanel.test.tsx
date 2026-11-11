import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { FineTunesView } from '../../../core/imageFineTunes'
import type { ImageRow } from '../../../core/images'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const isOff = (element: Element) => element.getAttribute('aria-disabled') === 'true'
const { act, createElement } = await import('react')
const { WhyTip } = await import('../../components/WhyTip')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { FineTunePanel } = await import('./FineTunePanel')

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
) {
  const sent: { method: string; path: string; body: unknown }[] = []
  globalThis.fetch = (async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET')
      return Response.json(String(path).endsWith('/fine-tunes') ? current() : {})
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
        createElement(FineTunePanel, { row: { id: 'inn', width: 1024, height: 576 } as ImageRow }),
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
    expect(text(host)).toContain('Take 3 — the picture in the game now')
    expect(text(host)).toContain('No fine-tunes yet. Describe a change and make a few.')
    expect(text(host)).toContain(
      'No area marked: the whole picture may change. Drag on the picture to keep the change to one place.',
    )
    expect(wordsBox(host).placeholder).toBe('Say what to add, remove or change')
    expect(isOff(button(host, 'Make fine-tunes')!)).toBe(true)
    await type(wordsBox(host), 'Add a black cat')
    expect(isOff(button(host, 'Make fine-tunes')!)).toBe(false)
    expect(host.querySelectorAll('select.takes-count option')).toHaveLength(6)
  })

  it('names the game’s own image when no take is chosen', async () => {
    const { host } = await render(() =>
      view({ picture: { kind: 'game', width: 1024, height: 576 } }),
    )
    expect(text(host)).toContain("The game's own image — the picture in the game now")
    expect(host.querySelector('img.patch-take')?.getAttribute('src')).toBe(
      '/api/images/inn/fine-tunes/base',
    )
  })

  it('keeps Make off, with the line under the menu, when the model is not on this computer', async () => {
    const { host } = await render(() =>
      view({ models: { 'qwen-edit': 'absent', klein: 'absent' } }),
    )
    await type(wordsBox(host), 'Add a cat')
    expect(isOff(button(host, 'Make fine-tunes')!)).toBe(true)
    expect(text(host)).toContain('Setup says how to download it.')
  })
})

describe('making fine-tunes', () => {
  it('asks for the words, the count, the model and no area', async () => {
    const { host, sent } = await render(() => view())
    await type(wordsBox(host), 'Add a black cat')
    await act(async () => button(host, 'Make fine-tunes')!.click())
    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/api/images/inn/fine-tunes',
        body: { count: 2, words: 'Add a black cat', area: null, model: 'klein' },
      },
    ])
  })

  it('marks an area by dragging, says so, asks with it, and clears it', async () => {
    const { host, sent } = await render(() => view())
    await drag(stageOf(host), [100, 50], [300, 250])
    expect(host.querySelector('.patch-mark')).not.toBeNull()
    expect(text(host)).toContain('Marked area: the change is kept to this place.')
    await type(wordsBox(host), 'Add a cat')
    await act(async () => button(host, 'Make fine-tunes')!.click())
    expect(sent[0]!.body).toMatchObject({ area: { x: 100, y: 50, width: 200, height: 200 } })
    await act(async () => button(host, 'Clear the mark')!.click())
    expect(host.querySelector('.patch-mark')).toBeNull()
    expect(text(host)).toContain('No area marked')
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
    expect(text(host)).toContain('Fine-tune 1 Being made… about 20 s left')
    expect(text(host)).toContain('Fine-tune 2 Waiting')
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
    expect(text(makingCard)).toBe('Fine-tune 1 Being made… about 20 s left Stop')
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
    const form = host.querySelector('.patch-bench-right')!
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

describe('looking at, dropping and using fine-tunes', () => {
  const ready = () => view({ tunes: [tune(1), tune(2, { isNew: true }), tune(3)] })

  it('shows each as a card, new ones with the chip, and lays one over the picture when pressed', async () => {
    const { host } = await render(ready)
    expect(cards(host).map((c) => text(c))).toEqual([
      'Fine-tune 1 Use this Drop',
      'Fine-tune 2 new Use this Drop',
      'Fine-tune 3 Use this Drop',
    ])
    // The newest is looked at to begin with.
    expect(text(host)).toContain('Looking at Fine-tune 3')
    await act(async () => cards(host)[0]!.querySelector('button')!.click())
    expect(text(host)).toContain('Looking at Fine-tune 1 Show the fine-tune (S)')
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
    expect(text(host)).toContain('Looking at Fine-tune 3')
    await key(pick, 'ArrowLeft')
    await key(pick, 'ArrowLeft')
    expect(text(host)).toContain('Looking at Fine-tune 1')
    expect(host.querySelector('img.patch-over')).not.toBeNull()
    await key(pick, 's')
    expect(host.querySelector('img.patch-over')).toBeNull()
    await key(pick, 's')
    await key(pick, 'd')
    expect(sent.filter((s) => s.method === 'DELETE')).toEqual([
      { method: 'DELETE', path: '/api/images/inn/fine-tunes/1', body: null },
    ])
  })

  it('rests the image’s own keys while focus is in the panel, and leaves typing alone', async () => {
    const { host } = await render(ready)
    const heard: string[] = []
    const listen = (event: KeyboardEvent) => heard.push(event.key)
    document.addEventListener('keydown', listen)
    cleanups.push(() => document.removeEventListener('keydown', listen))
    await key(cards(host)[0]!.querySelector('button')!, 'ArrowRight')
    expect(heard).toEqual([])
    await key(wordsBox(host), 'd')
    expect(heard).toEqual(['d'])
  })

  it('uses one at once, says what came along, empties the words, and Close puts the line away', async () => {
    const { host, sent } = await render(ready, {
      status: 200,
      body: { ok: true, take: 4, from: 3, carried: { areas: 3, patches: 1 } },
    })
    await type(wordsBox(host), 'leftover words')
    await act(async () => cards(host)[1]!.querySelectorAll('button')[1]!.click())
    await settle()
    expect(sent).toEqual([
      { method: 'POST', path: '/api/images/inn/fine-tunes/use', body: { n: 2 } },
    ])
    expect(text(host.querySelector('[role=status]'))).toBe(
      'Take 4 is in the game now. Its 3 named areas and 1 chosen patch came along from Take 3. Close',
    )
    expect(wordsBox(host).value).toBe('')
    expect(document.activeElement).toBe(wordsBox(host))
    await act(async () => button(host, 'Close')!.click())
    expect(host.querySelector('[role=status]')).toBeNull()
  })

  it('keeps the came-along line on the new take, and puts it away when another take is chosen', async () => {
    let served = ready()
    const { host, client } = await render(() => served, {
      status: 200,
      body: { ok: true, take: 4, from: 3, carried: { areas: 3, patches: 1 } },
    })
    await act(async () => cards(host)[1]!.querySelectorAll('button')[1]!.click())
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
    await act(async () => cards(host)[1]!.querySelectorAll('button')[1]!.click())
    await settle()
    expect(text(host)).toContain('The images lock could not be read.')
    expect(cards(host)).toHaveLength(3)
  })
})
