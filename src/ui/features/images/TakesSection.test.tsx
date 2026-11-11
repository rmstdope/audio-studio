import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ImageRow } from '../../../core/images'
import type { ImageTakeView, ImageTakesView } from '../../../core/imageTakes'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const isOff = (element: Element) => element.getAttribute('aria-disabled') === 'true'
const { act, createElement, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { TakesSection } = await import('./TakesSection')
const { useSetImageWords } = await import('../../api')
const { TakePicture } = await import('./TakePicture')

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
  patches: [],
  areas: [],
  prompt: 'a low inn',
  actStyle: null,
  sharedWith: [],
  actStyleChange: null,
  chosenTake: null,
  gameFile: null,
  madeFrom: { words: 'a low inn', style: '', width: 320, height: 200 },
  status: 'none yet',
  reasons: [],
  look: {
    line: "320 × 200 · the game's palette, 2 colours · patterned dithering",
    key: 'k',
    error: null,
  },
  looksOld: false,
}

const take = (n: number, over: Partial<ImageTakeView> = {}): ImageTakeView => ({
  n,
  width: 1024,
  height: 640,
  model: 'klein',
  earlier: false,
  chosen: false,
  isNew: false,
  look: 'ready',
  cropped: false,
  ...over,
})

const view = (over: Partial<ImageTakesView> = {}): ImageTakesView => ({
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
  ...over,
})

/** Shows the section with this view, and records what the page asks the server. */
async function show(
  data: ImageTakesView,
  over: Partial<ImageRow> = {},
  prompt?: ReturnType<typeof createElement>,
  answer: unknown = { ok: true },
) {
  const calls: { url: string; method: string; body: unknown }[] = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    return Response.json(answer)
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
  const draw = (now: Partial<ImageRow>) =>
    act(() =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(TakesSection, { row: { ...row, ...over, ...now }, prompt }),
        ),
      ),
    )
  draw({})
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
  const rerender = (now: Partial<ImageRow>) => draw(now)
  return { client, container, calls, buttons, button, click, key, text, right, left, rerender }
}

const three = [take(1), take(2), take(3)]

/** Drops focus from a focused button the moment it is switched off, as Chrome does; happy-dom does not. */
function dropFocusWhenDisabled(container: Element) {
  const observer = new MutationObserver((records) => {
    for (const r of records)
      if (
        r.attributeName === 'disabled' &&
        r.target === document.activeElement &&
        (r.target as HTMLButtonElement).disabled
      ) {
        // happy-dom's blur() does nothing on a disabled button, so focus is moved away instead.
        const away = document.createElement('div')
        away.tabIndex = -1
        document.body.append(away)
        away.focus()
        away.remove()
      }
  })
  observer.observe(container, { attributes: true, subtree: true })
  cleanups.push(() => observer.disconnect())
}

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
    expect(s.text()).toContain(
      'Press a take, or use ← →, to put it beside the image the game uses.',
    )
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

  it('says what a fine-tuned take was fine-tuned from, on the left and on the right', async () => {
    const from3 = { take: 3, words: 'Add a black cat' }
    const own = { take: null, words: 'Add a lamp' }
    const s = await show(
      view({
        takes: [
          take(1, { fineTunedFrom: own }),
          take(2),
          take(4, { chosen: true, fineTunedFrom: from3 }),
        ],
      }),
      { chosenTake: 4, status: 'chosen' },
    )
    const line = (side: string) =>
      s.container.querySelector(`[data-side="${side}"] .fine-tuned-from`)?.textContent
    expect(line('left')).toBe('Fine-tuned from Take 3: “Add a black cat”')
    expect(s.container.querySelector('[data-side="right"] .fine-tuned-from')).toBeNull()
    await s.click(s.container.querySelector('[data-strip] button')!)
    expect(line('right')).toBe("Fine-tuned from the game's own image: “Add a lamp”")
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
    await act(async () => await new Promise((r) => setTimeout(r, 20)))
    await s.click(s.button('Drop'))
    expect(cancelled).toHaveLength(2)
  })

  it('after Choose, focus is on the right side’s Choose button, once the change is done', async () => {
    const s = await show(view({ takes: [take(1), take(2, { chosen: true }), take(3)] }), {
      chosenTake: 2,
    })
    s.button('Choose').focus()
    await s.click(s.button('Choose'))
    await act(async () => {})
    expect(document.activeElement).toBe(s.button('Choose'))
  })

  it('after Choose, focus survives the button being off while the choice is saved (as in Chrome)', async () => {
    const s = await show(view({ takes: [take(1), take(2, { chosen: true }), take(3)] }), {
      chosenTake: 2,
    })
    dropFocusWhenDisabled(s.container)
    let release: () => void = () => {}
    globalThis.fetch = (async () => {
      await new Promise<void>((resolve) => (release = resolve))
      return Response.json({ ok: true })
    }) as unknown as typeof fetch
    s.button('Choose').focus()
    await s.click(s.button('Choose'))
    await act(async () => release())
    for (let i = 0; i < 5; i++) await act(async () => await new Promise((r) => setTimeout(r, 5)))
    expect(document.activeElement).toBe(s.button('Choose'))
  })

  it('after the first Choose from nothing, focus is on the right side’s Choose button', async () => {
    const s = await show(view({ takes: three }))
    s.button('Choose').focus()
    await s.click(s.button('Choose'))
    await act(async () => {})
    expect(document.activeElement).toBe(s.button('Choose'))
  })

  it('asks for the game’s picture of the chosen take only after the choice is saved', async () => {
    const s = await show(view({ takes: three }))
    let release: () => void = () => {}
    globalThis.fetch = (async () => {
      await new Promise<void>((resolve) => (release = resolve))
      return Response.json({ ok: true })
    }) as unknown as typeof fetch
    const current = () =>
      [...s.container.querySelectorAll<HTMLImageElement>('img')].filter((i) =>
        i.src.includes('/current'),
      )
    await s.click(s.button('Choose'))
    expect(current()).toHaveLength(0)
    await act(async () => release())
    for (let i = 0; i < 5; i++) await act(async () => await new Promise((r) => setTimeout(r, 5)))
    expect(current().length).toBeGreaterThan(0)
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

describe('patches set aside', () => {
  const patch = (title: string, chosenOn: number[], chosenOnGone = false) => ({
    id: title.toLowerCase().replace(/ /g, '-'),
    title,
    description: '',
    words: '',
    changed: false,
    gameChanged: false,
    gameWas: null,
    chosenOn,
    chosenOnGone,
    chosenArea: null,
  })
  const three = [patch('Bread taken', [2]), patch('Door open', [2]), patch('Lamp lit', [2])]
  /** Take 2 is in the game with these patches chosen on it; takes 1 and 4 are others. */
  const inGame = (patches = three, answer: unknown = { ok: true }) =>
    show(
      view({ takes: [take(1), take(2, { chosen: true }), take(4)] }),
      { chosenTake: 2, status: 'chosen', patches },
      undefined,
      answer,
    )
  const q = (s: Awaited<ReturnType<typeof inGame>>) =>
    s.container.querySelector('[role="alertdialog"]')

  it('asks before Choose, in the place of the picture in the game, and names the patches', async () => {
    const s = await inGame()
    await s.click(s.button('Choose'))
    expect(s.calls).toHaveLength(0)
    expect(s.container.querySelector('[data-side="left"] [role="alertdialog"]')).not.toBeNull()
    expect(s.text()).toContain('Choose take 4?')
    expect(s.text()).toContain(
      '3 chosen patches were made on take 2. The game will stop showing them until you make new ones.',
    )
    expect([...q(s)!.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Bread taken',
      'Door open',
      'Lamp lit',
    ])
    expect(s.text()).toContain('Choosing take 2 again brings them all back.')
    expect(s.button('Choose take 4')).toBeDefined()
    expect(document.activeElement?.textContent).toBe('Choose take 4')
    // the take on the right stays in view with Drop and Choose off
    expect(s.right()).toBe('Take 4')
    expect(isOff(s.button('Drop'))).toBe(true)
    expect(isOff(s.button('Choose'))).toBe(true)
  })

  it('chooses on the yes and not before', async () => {
    const s = await inGame()
    await s.click(s.button('Choose'))
    await s.click(s.button('Choose take 4'))
    expect(s.calls.at(-1)).toMatchObject({ url: '/api/images/inn/choose', body: { n: 4 } })
    expect(q(s)).toBeNull()
  })

  it('asks the same on C, rests ← → C D while open, and Cancel returns focus to Choose', async () => {
    const s = await inGame()
    await s.key('c')
    expect(s.text()).toContain('Choose take 4?')
    await s.key('ArrowLeft')
    await s.key('c')
    await s.key('d')
    expect(s.right()).toBe('Take 4')
    expect(s.calls).toHaveLength(0)
    await s.click(s.button('Cancel'))
    expect(s.calls).toHaveLength(0)
    expect(q(s)).toBeNull()
    expect(document.activeElement?.textContent).toBe('Choose')
  })

  it('says the singular words for one patch', async () => {
    const s = await inGame([patch('Bread taken', [2])])
    await s.click(s.button('Choose'))
    expect(s.text()).toContain(
      '1 chosen patch was made on take 2. The game will stop showing it until you make a new one.',
    )
    expect(s.text()).toContain('Choosing take 2 again brings it back.')
  })

  it('says which patches come back with the take chosen', async () => {
    const s = await inGame([
      patch('Bread taken', [2]),
      patch('Door open', [4]),
      patch('Lamp lit', [4]),
    ])
    await s.click(s.button('Choose'))
    expect(s.text()).toContain(
      '2 patches made on take 4 come back: Door open, Lamp lit. Choosing take 2 again brings Bread taken back.',
    )
  })

  it('does not ask when the take in the game has no chosen patches, even if the new one has some', async () => {
    const s = await inGame([patch('Door open', [4]), patch('Well', [])])
    await s.click(s.button('Choose'))
    expect(q(s)).toBeNull()
    expect(s.calls.at(-1)).toMatchObject({ url: '/api/images/inn/choose' })
  })

  it('keeps the question open with the studio’s message in red when the choice cannot be saved', async () => {
    const s = await inGame(three, { ok: false, message: 'manifest.json cannot be used' })
    await s.click(s.button('Choose'))
    await s.click(s.button('Choose take 4'))
    expect(q(s)).not.toBeNull()
    expect(q(s)!.querySelector('.adopt-error')?.textContent).toBe('manifest.json cannot be used')
    expect(s.left()).not.toBe('Take 4')
  })

  it('adds the patches to the Un-choose question, with its own words and button', async () => {
    const s = await inGame()
    await s.click(s.button('Un-choose'))
    expect(s.text()).toContain('Un-choose take 2?')
    expect(s.text()).toContain(
      'The game shows no image here until you choose another. Take 2 stays among the takes.',
    )
    expect(s.text()).toContain('3 chosen patches were made on take 2.')
    expect([...q(s)!.querySelectorAll('li')]).toHaveLength(3)
    expect(s.text()).toContain('Choosing take 2 again brings them all back.')
    await s.click(s.button('Un-choose'))
    expect(s.calls.at(-1)).toMatchObject({ url: '/api/images/inn/unchoose' })
  })

  it('asks before Drop of a take with patches set aside, in the place of its picture', async () => {
    const s = await inGame([
      patch('Bread taken', [4]),
      patch('Door open', [4]),
      patch('Lamp lit', []),
    ])
    await s.click(s.button('Drop'))
    expect(s.calls).toHaveLength(0)
    expect(s.container.querySelector('[data-side="right"] [role="alertdialog"]')).not.toBeNull()
    expect(s.text()).toContain('Drop take 4?')
    expect(s.text()).toContain(
      '2 chosen patches were made on take 4. After this they cannot be brought back; only new ones can be made.',
    )
    expect([...q(s)!.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Bread taken',
      'Door open',
    ])
    await s.click(s.button('Cancel'))
    expect(document.activeElement?.textContent).toBe('Drop')
    await s.key('d')
    await s.click(s.button('Drop take 4'))
    expect(s.calls.at(-1)).toMatchObject({ url: '/api/images/inn/takes/4', method: 'DELETE' })
  })

  it('keeps the question’s words on screen until the save and the reload are done', async () => {
    const s = await inGame()
    await s.click(s.button('Choose'))
    // the project reload after the save is slow: the row already shows the new take meanwhile
    globalThis.fetch = (async () => new Promise(() => {})) as unknown as typeof fetch
    await s.click(s.button('Choose take 4'))
    s.rerender({ chosenTake: 4, patches: three.map((p) => ({ ...p, chosenOn: [2] })) })
    expect(q(s)!.textContent).toContain('3 chosen patches were made on take 2.')
    expect(q(s)!.querySelectorAll('li')).toHaveLength(3)
  })

  it('Cancel of the Drop question returns focus to Drop, with the button and with D', async () => {
    const s = await inGame([patch('Bread taken', [4])])
    await s.key('d')
    await s.click(s.button('Cancel'))
    expect(document.activeElement?.textContent).toBe('Drop')
  })

  it('keeps the Un-choose question open with the message, also when the request fails', async () => {
    const refused = await inGame(three, { ok: false, message: 'cannot be used' })
    await refused.click(refused.button('Un-choose'))
    await refused.click(refused.button('Un-choose'))
    for (let i = 0; i < 20 && !q(refused)?.querySelector('.adopt-error'); i++) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 5)))
    }
    expect(q(refused)!.querySelector('.adopt-error')?.textContent).toBe('cannot be used')
    const failed = await inGame()
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    await failed.click(failed.button('Choose'))
    await failed.click(failed.button('Choose take 4'))
    for (let i = 0; i < 20 && !q(failed)?.querySelector('.adopt-error'); i++) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 5)))
    }
    expect(q(failed)!.querySelector('.adopt-error')?.textContent).toBe('network down')
    expect(q(failed)!.textContent).toContain('3 chosen patches were made on take 2.')
  })

  it('switches Un-choose off while a question is open', async () => {
    const s = await inGame([patch('Bread taken', [4])])
    await s.click(s.button('Drop'))
    expect(isOff(s.button('Un-choose'))).toBe(true)
  })

  it('drops at once a take with no patches set aside', async () => {
    const s = await inGame()
    await s.click(s.button('Drop'))
    expect(q(s)).toBeNull()
    expect(s.calls.at(-1)).toMatchObject({ method: 'DELETE' })
  })

  it('keeps the Drop question open with the message when the drop cannot be saved', async () => {
    const s = await inGame([patch('Bread taken', [4])], { ok: false, message: 'no luck' })
    await s.click(s.button('Drop'))
    await s.click(s.button('Drop take 4'))
    for (let i = 0; i < 20 && !q(s)?.querySelector('.adopt-error'); i++) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 5)))
    }
    expect(q(s)!.querySelector('.adopt-error')?.textContent).toBe('no luck')
    expect(s.right()).toBe('Take 4')
  })
})

describe('named areas set aside', () => {
  const box = { x: 1, y: 1, width: 10, height: 10 }
  const area = (title: string, ...takes: number[]) => ({
    id: title.toLowerCase().replace(/ /g, '-'),
    title,
    placed: takes.includes(2),
    box: takes.includes(2) ? box : null,
    boxes: Object.fromEntries(takes.map((n) => [n, box])),
    elsewhere: [],
    elsewhereGone: false,
  })
  const patch = (title: string, chosenOn: number[]) => ({
    id: title.toLowerCase().replace(/ /g, '-'),
    title,
    description: '',
    words: '',
    changed: false,
    gameChanged: false,
    gameWas: null,
    chosenOn,
    chosenOnGone: false,
    chosenArea: null,
  })
  const five = ['Bucket', 'Well', 'Cottage door', 'Old oak', 'Path north'].map((t) => area(t, 2))
  const inGame = (
    areas = five,
    patches: ReturnType<typeof patch>[] = [],
    answer: unknown = { ok: true },
  ) =>
    show(
      view({ takes: [take(1), take(2, { chosen: true }), take(4)] }),
      { chosenTake: 2, status: 'chosen', areas, patches },
      undefined,
      answer,
    )
  const q = (s: Awaited<ReturnType<typeof inGame>>) =>
    s.container.querySelector('[role="alertdialog"]')
  const items = (s: Awaited<ReturnType<typeof inGame>>) =>
    [...q(s)!.querySelectorAll('li')].map((li) => li.textContent)

  it('asks before Choose when areas are placed, naming them with no headings', async () => {
    const s = await inGame()
    await s.click(s.button('Choose'))
    expect(s.calls).toHaveLength(0)
    expect(s.container.querySelector('[data-side="left"] [role="alertdialog"]')).not.toBeNull()
    expect(s.text()).toContain('Choose take 4?')
    expect(s.text()).toContain(
      '5 named areas are placed on take 2. The game will stop using them until you place them on take 4.',
    )
    expect(items(s)).toEqual(['Bucket', 'Well', 'Cottage door', 'Old oak', 'Path north'])
    expect(q(s)!.querySelector('h4')).toBeNull()
    expect(s.text()).toContain('Choosing take 2 again brings them all back.')
    expect(document.activeElement?.textContent).toBe('Choose take 4')
    expect(isOff(s.button('Drop'))).toBe(true)
    await s.click(s.button('Choose take 4'))
    expect(s.calls.at(-1)).toMatchObject({ url: '/api/images/inn/choose', body: { n: 4 } })
  })

  it('names only the areas placed on the take in the game', async () => {
    const s = await inGame([area('Bucket', 2), area('Well', 1)])
    await s.click(s.button('Choose'))
    expect(items(s)).toEqual(['Bucket'])
    expect(s.text()).toContain('1 named area is placed on take 2.')
    expect(s.text()).toContain('Choosing take 2 again brings it back.')
  })

  it('asks once for patches and areas, in two lists under small headings, patches first', async () => {
    const s = await inGame([area('Bucket', 2), area('Well', 2)], [patch('Door open', [2])])
    await s.click(s.button('Choose'))
    expect(s.text()).toContain(
      'Take 2 has 1 chosen patch and 2 placed named areas. The game will stop showing the patch and stop using the areas until you make and place them again.',
    )
    expect([...q(s)!.querySelectorAll('h4')].map((h) => h.textContent)).toEqual([
      'Patches',
      'Named areas',
    ])
    expect(items(s)).toEqual(['Door open', 'Bucket', 'Well'])
  })

  it('counts the areas that come back with the take chosen', async () => {
    const s = await inGame([area('Bucket', 2), area('Well', 4), area('Gate', 4)])
    await s.click(s.button('Choose'))
    expect(s.text()).toContain(
      '2 named areas placed on take 4 come back. Choosing take 2 again brings back what leaves now.',
    )
  })

  it('asks nothing when the take in the game has no placed areas, also if the new one has some', async () => {
    const s = await inGame([area('Bucket', 4), area('Well')])
    await s.click(s.button('Choose'))
    expect(q(s)).toBeNull()
    expect(s.calls.at(-1)).toMatchObject({ url: '/api/images/inn/choose' })
  })

  it('adds the areas to the Un-choose question', async () => {
    const s = await inGame()
    await s.click(s.button('Un-choose'))
    expect(s.text()).toContain('Un-choose take 2?')
    expect(s.text()).toContain(
      'The game shows no image here until you choose another. Take 2 stays among the takes.',
    )
    expect(s.text()).toContain(
      '5 named areas are placed on take 2. The game will stop using them until you place them on another take.',
    )
    await s.click(s.button('Un-choose'))
    expect(s.calls.at(-1)).toMatchObject({ url: '/api/images/inn/unchoose' })
  })

  it('asks before Drop of a take with areas set aside on it, in the place of its picture', async () => {
    const s = await inGame([area('Bucket', 4), area('Well', 4), area('Gate', 2)])
    await s.click(s.button('Drop'))
    expect(s.calls).toHaveLength(0)
    expect(s.container.querySelector('[data-side="right"] [role="alertdialog"]')).not.toBeNull()
    expect(s.text()).toContain('Drop take 4?')
    expect(s.text()).toContain(
      '2 named areas were placed on take 4. After this they cannot be brought back; only new ones can be placed.',
    )
    expect(items(s)).toEqual(['Bucket', 'Well'])
    await s.click(s.button('Cancel'))
    expect(document.activeElement?.textContent).toBe('Drop')
    await s.key('d')
    await s.click(s.button('Drop take 4'))
    expect(s.calls.at(-1)).toMatchObject({ url: '/api/images/inn/takes/4', method: 'DELETE' })
  })

  it('keeps the question open with the message in red when it cannot be saved', async () => {
    const s = await inGame(five, [], { ok: false, message: 'manifest.json cannot be used' })
    await s.click(s.button('Choose'))
    await s.click(s.button('Choose take 4'))
    expect(q(s)!.querySelector('.adopt-error')?.textContent).toBe('manifest.json cannot be used')
  })
})

describe('making takes', () => {
  const making = [
    { n: 4, state: 'making' as const, elapsed: 10, expected: 60 },
    { n: 5, state: 'waiting' as const, elapsed: 0, expected: 60 },
  ]

  it('shows each take in the strip at once, with Stop, and the menus wait', async () => {
    const s = await show(view({ takes: [take(1), take(2)], making }))
    expect(s.text()).toContain('making · about 50 s left')
    expect(s.text()).toContain('waiting')
    expect(s.container.querySelectorAll('[role="progressbar"]')).toHaveLength(2)
    expect(isOff(s.button('Stop'))).toBe(false)
    expect(isOff(s.container.querySelector<HTMLSelectElement>('select')!)).toBe(true)
    expect(isOff(s.button('Make 2 more takes'))).toBe(true)
    await s.click(s.button('Stop'))
    expect(s.calls.at(-1)).toMatchObject({ url: '/api/images/inn/stop', method: 'POST' })
  })

  it('after Make takes, focus stays in the Takes section, so ← and → still step the right side (as in Chrome)', async () => {
    const s = await show(view({ takes: [take(1), take(2), take(3)] }))
    dropFocusWhenDisabled(s.container)
    let release: () => void = () => {}
    globalThis.fetch = (async () => {
      await new Promise<void>((resolve) => (release = resolve))
      return Response.json({ ok: true })
    }) as unknown as typeof fetch
    const makeButton = s.button('Make 2 more takes')
    makeButton.focus()
    const scrolls: unknown[] = []
    const focus = HTMLElement.prototype.focus
    HTMLElement.prototype.focus = function (options?: FocusOptions) {
      scrolls.push(options?.preventScroll)
      focus.call(this, options)
    }
    cleanups.push(() => (HTMLElement.prototype.focus = focus))
    await s.click(makeButton)
    const onRight = s.container.querySelector('[data-strip] [aria-pressed="true"]')
    expect(onRight?.textContent).toContain('Take 3')
    expect(document.activeElement).toBe(onRight)
    // A press with the mouse leaves the page where it is, with the strip below the fold.
    expect(scrolls.at(-1)).toBe(true)
    expect(s.right()).toBe('Take 3')
    await s.key('ArrowLeft', document.activeElement!)
    expect(s.right()).toBe('Take 2')
    await act(async () => release())
  })

  it('after the first Make takes, focus stays in the Takes section (as in Chrome)', async () => {
    const s = await show(view())
    dropFocusWhenDisabled(s.container)
    s.button('Make 2 takes').focus()
    await s.click(s.button('Make 2 takes'))
    expect(document.activeElement?.textContent).toBe('Comparing')
  })

  it('does not move the right side when a take finishes', async () => {
    const first = await show(view({ takes: [take(1)] }))
    expect(first.right()).toBe('Take 1')
    const s = await show(view({ takes: [take(1), take(2, { isNew: true })] }))
    await s.click(s.container.querySelector<HTMLButtonElement>('[data-strip] button')!)
    expect(s.right()).toBe('Take 1')
    expect(s.container.textContent).toContain('new')
  })

  it('keeps the number of takes picked after Make', async () => {
    const s = await show(view({ takes: three }))
    const count = s.container.querySelector<HTMLSelectElement>('select.takes-count')!
    await act(async () => {
      count.value = '4'
      count.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await s.click(s.button('Make 4 more takes'))
    expect(s.calls.at(-1)).toMatchObject({ body: { count: 4 } })
    expect(count.value).toBe('4')
    expect(s.button('Make 4 more takes')).toBeTruthy()
  })

  it('the count menu offers 1 to 4 takes, starts at 2 and names the button', async () => {
    const s = await show(view({ takes: [take(1)] }))
    const options = [...s.container.querySelectorAll('select.takes-count option')]
    expect(options.map((o) => o.textContent)).toEqual(['1 take', '2 takes', '3 takes', '4 takes'])
    expect(s.container.querySelector<HTMLSelectElement>('select.takes-count')!.value).toBe('2')
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
    expect(s.text()).toContain(
      'No image model can run on this computer. Setup says what is missing.',
    )
    expect(s.container.querySelector('a')?.getAttribute('href')).toBe('#/setup')
    expect(isOff(s.button('Make 2 more takes'))).toBe(true)
    expect(isOff(s.container.querySelector<HTMLSelectElement>('select')!)).toBe(true)
    expect(isOff(s.button('Choose'))).toBe(false)
    expect(isOff(s.button('Drop'))).toBe(false)
  })

  it('while the lock cannot be read, nothing is chosen, dropped or un-chosen', async () => {
    const s = await show(view({ takes: [take(1, { chosen: true }), take(2)], lockUnread: true }), {
      chosenTake: 1,
    })
    expect(isOff(s.button('Choose'))).toBe(true)
    expect(isOff(s.button('Drop'))).toBe(true)
    expect(isOff(s.button('Un-choose'))).toBe(true)
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

describe('the Takes section’s model menu', () => {
  type Id = 'klein' | 'z-image-turbo' | 'qwen-image'
  /** Only this model is here; the other two are not downloaded. */
  const only = (id: Id) => [
    model('klein', id === 'klein' ? 'whole' : 'absent'),
    model('z-image-turbo', id === 'z-image-turbo' ? 'whole' : 'absent'),
    model('qwen-image', id === 'qwen-image' ? 'whole' : 'absent'),
  ]
  const model = (id: Id, download: 'whole' | 'partial' | 'absent', failed = false) => ({
    id,
    installed: download === 'whole',
    download,
    failed,
  })
  const modelMenu = (s: { container: HTMLElement }) =>
    s.container.querySelector<HTMLSelectElement>('select[aria-label="Model for new takes"]')!
  /** The text of the closed menu's face, which wraps in a narrow window. */
  const faceOf = (s: { container: HTMLElement }) =>
    modelMenu(s).closest('.menu-face')!.firstElementChild!.textContent
  const pick = (s: { container: HTMLElement }, value: string) =>
    act(async () => {
      modelMenu(s).value = value
      modelMenu(s).dispatchEvent(new Event('change', { bubbles: true }))
    })

  it('comes before the count menu, starts on the project’s model, and lists the three with their times', async () => {
    const s = await show(view({ takes: three }))
    const menus = [...s.container.querySelectorAll('select')].map((m) =>
      m.getAttribute('aria-label'),
    )
    expect(menus).toEqual(['Model for new takes', 'Number of new takes'])
    expect(modelMenu(s).value).toBe('klein')
    expect([...modelMenu(s).options].map((o) => o.textContent)).toEqual([
      'FLUX.2 klein 4B — a guess: about 20 s a take',
      'Z-Image-Turbo — a guess: about 1 min a take',
      'Qwen-Image — a guess: about 4 min a take',
    ])
    // Closed, a face that can wrap shows the short name and the time; the list keeps full entries.
    expect(faceOf(s)).toBe('FLUX.2 klein — a guess: about 20 s a take')
    expect(modelMenu(s).options[0]!.hasAttribute('label')).toBe(false)
  })

  it('reads each model for itself: timed here loses the word guess, the other keeps it', async () => {
    const s = await show(view({ takes: three }))
    await act(async () => {
      s.client.setQueryData(['image-take-times'], {
        klein: { seconds: 23, guess: false },
        'z-image-turbo': { seconds: 60, guess: true },
        'qwen-image': { seconds: 240, guess: true },
        'qwen-edit': { seconds: 480, guess: true },
        'klein-edit': { seconds: 20, guess: true },
      })
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
    expect([...modelMenu(s).options].map((o) => o.textContent)).toEqual([
      'FLUX.2 klein 4B — about 25 s a take',
      'Z-Image-Turbo — a guess: about 1 min a take',
      'Qwen-Image — a guess: about 4 min a take',
    ])
    expect(faceOf(s)).toBe('FLUX.2 klein — about 25 s a take')
  })

  it('has the face follow the model picked', async () => {
    const s = await show(view({ takes: three }))
    await pick(s, 'z-image-turbo')
    expect(faceOf(s)).toBe('Z-Image-Turbo — a guess: about 1 min a take')
  })

  it('starts on Setup’s model when that is the other one', async () => {
    const s = await show(view({ takes: three, projectModel: 'z-image-turbo' }))
    expect(modelMenu(s).value).toBe('z-image-turbo')
  })

  it('makes takes with Qwen-Image when it is picked, and a missing Qwen-Image is listed but cannot be picked', async () => {
    const s = await show(view({ takes: three }))
    await pick(s, 'qwen-image')
    expect(modelMenu(s).value).toBe('qwen-image')
    expect(faceOf(s)).toBe('Qwen-Image — a guess: about 4 min a take')
    await s.click(s.button('Make 2 more takes'))
    expect(s.calls.at(-1)).toMatchObject({ body: { count: 2, model: 'qwen-image' } })
    const absent = await show(
      view({
        takes: three,
        models: [
          model('klein', 'whole'),
          model('z-image-turbo', 'whole'),
          model('qwen-image', 'absent'),
        ],
      }),
    )
    const q = modelMenu(absent).options[2]!
    expect(q.textContent).toContain(' — not on this computer')
    expect(q.disabled).toBe(true)
  })

  it('starts on the fastest model in place, in menu order, when Qwen-Image is the project’s and is missing', async () => {
    const s = await show(
      view({
        takes: three,
        projectModel: 'qwen-image',
        models: [
          model('klein', 'whole'),
          model('z-image-turbo', 'whole'),
          model('qwen-image', 'absent'),
        ],
      }),
    )
    expect(modelMenu(s).value).toBe('klein')
    expect(s.text()).toContain(
      "Qwen-Image, the project's image model, isn't on this computer, so these takes use FLUX.2 klein. Setup says how to download it.",
    )
  })

  it('makes takes with the model picked', async () => {
    const s = await show(view({ takes: three }))
    await pick(s, 'z-image-turbo')
    await s.click(s.button('Make 2 more takes'))
    expect(s.calls.at(-1)).toMatchObject({
      url: '/api/images/inn/takes',
      body: { count: 2, model: 'z-image-turbo' },
    })
  })

  it('lists a model that is not here as such, and cannot be picked', async () => {
    const s = await show(view({ takes: three, models: only('klein') }))
    const z = modelMenu(s).options[1]!
    expect(z.textContent).toBe('Z-Image-Turbo — a guess: about 1 min a take — not on this computer')
    expect(z.disabled).toBe(true)
    expect(s.text()).not.toContain("isn't on this computer")
  })

  it('starts on the model that is here when the project’s is missing, and says so', async () => {
    const s = await show(view({ takes: three, models: only('z-image-turbo') }))
    expect(modelMenu(s).value).toBe('z-image-turbo')
    expect(s.text()).toContain(
      "FLUX.2 klein, the project's image model, isn't on this computer, so these takes use Z-Image-Turbo. Setup says how to download it.",
    )
    await s.click(s.button('Make 2 more takes'))
    expect(s.calls.at(-1)).toMatchObject({ body: { count: 2, model: 'z-image-turbo' } })
  })

  it('marks a model whose last take failed, which can still be picked', async () => {
    const s = await show(
      view({
        takes: three,
        models: [
          model('klein', 'whole'),
          model('z-image-turbo', 'whole', true),
          model('qwen-image', 'whole'),
        ],
      }),
    )
    const z = modelMenu(s).options[1]!
    expect(z.textContent).toBe('Z-Image-Turbo — a guess: about 1 min a take — last take failed')
    expect(z.disabled).toBe(false)
    expect(modelMenu(s).value).toBe('klein')
  })

  it('marks a partly downloaded model, which cannot be picked', async () => {
    const s = await show(
      view({
        takes: three,
        models: [
          model('klein', 'whole'),
          model('z-image-turbo', 'partial'),
          model('qwen-image', 'whole'),
        ],
      }),
    )
    const z = modelMenu(s).options[1]!
    expect(z.textContent).toBe('Z-Image-Turbo — a guess: about 1 min a take — download incomplete')
    expect(z.disabled).toBe(true)
  })

  it('starts on the other model when the main one failed its last take, and says so', async () => {
    const s = await show(
      view({
        takes: three,
        models: [
          model('klein', 'whole', true),
          model('z-image-turbo', 'whole'),
          model('qwen-image', 'whole'),
        ],
      }),
    )
    expect(modelMenu(s).value).toBe('z-image-turbo')
    expect(s.text()).toContain(
      "FLUX.2 klein, the project's image model, failed on its last take, so these takes use Z-Image-Turbo. Setup says what went wrong.",
    )
    expect(modelMenu(s).options[0]!.disabled).toBe(false)
    await pick(s, 'klein')
    expect(modelMenu(s).value).toBe('klein')
    await s.click(s.button('Make 2 more takes'))
    expect(s.calls.at(-1)).toMatchObject({ body: { count: 2, model: 'klein' } })
  })

  it('stays on the failed main model when the other is not in place', async () => {
    const s = await show(
      view({
        takes: three,
        models: [
          model('klein', 'whole', true),
          model('z-image-turbo', 'partial'),
          model('qwen-image', 'absent'),
        ],
      }),
    )
    expect(modelMenu(s).value).toBe('klein')
    expect(s.text()).not.toContain('failed on its last take')
    expect(modelMenu(s).options[0]!.textContent).toContain('last take failed')
  })

  it('waits while takes are being made', async () => {
    const s = await show(
      view({ takes: three, making: [{ n: 4, state: 'making', elapsed: 1, expected: 8 }] }),
    )
    expect(isOff(modelMenu(s))).toBe(true)
  })

  it('names the model after each take on the two sides, and not in the strip', async () => {
    const s = await show(
      view({
        takes: [
          take(2, { chosen: true, model: 'z-image-turbo' }),
          take(3),
          take(4, { model: 'klein' }),
        ],
      }),
      { chosenTake: 2, status: 'chosen' },
    )
    const side = (name: string) => s.container.querySelector(`[data-side="${name}"] .take-row`)!
    expect(side('left').textContent).toContain('Take 2')
    expect(side('left').textContent).toContain('Chosen')
    expect(side('left').textContent).toContain('Z-Image-Turbo')
    expect(side('right').textContent).toContain('Take 4')
    expect(side('right').textContent).toContain('FLUX.2 klein')
    const strip = s.container.querySelector('[data-strip]') ?? s.container
    const thumbs = [...strip.querySelectorAll('.image-thumb-label')].map((t) => t.textContent)
    expect(thumbs.join(' ')).not.toContain('FLUX')
  })

  it('says images can’t be made yet when no model can run, and waits', async () => {
    const s = await show(
      view({
        takes: three,
        generator: { ok: false, message: 'No image model is on this computer.', fix: 'x' },
        models: [
          model('klein', 'absent'),
          model('z-image-turbo', 'absent'),
          model('qwen-image', 'absent'),
        ],
      }),
    )
    expect(s.text()).toContain("Images can't be made yet.")
    expect(s.text()).toContain(
      'No image model can run on this computer. Setup says what is missing.',
    )
    expect(s.text()).toContain('Open Setup')
    expect(isOff(modelMenu(s))).toBe(true)
    expect(
      isOff(
        s.container.querySelector<HTMLSelectElement>('select[aria-label="Number of new takes"]')!,
      ),
    ).toBe(true)
    expect(isOff(s.button('Make 2 more takes'))).toBe(true)
    expect(s.text()).not.toContain("isn't on this computer")
  })
})

describe('a take’s picture', () => {
  const imgs = (s: { container: HTMLElement }, side: string) =>
    [...s.container.querySelectorAll(`[data-side="${side}"] img`)].map((i) => ({
      alt: i.getAttribute('alt'),
      src: i.getAttribute('src'),
    }))
  const sources = (s: { container: HTMLElement }, where: string) =>
    [...s.container.querySelectorAll(`${where} img`)].map(
      (i) => i.getAttribute('src')!.split('?')[0],
    )
  const box = (s: { container: HTMLElement }) =>
    s.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
  const captions = (s: { container: HTMLElement }, side: string) =>
    [...s.container.querySelectorAll(`[data-side="${side}"] .look-side > .small`)].map(
      (l) => l.textContent,
    )

  it('shows what the game gets for every take at first, each with its size', async () => {
    const s = await show(view({ takes: [take(1, { chosen: true }), take(2), take(3)] }))
    expect(box(s).checked).toBe(true)
    expect(box(s).closest('label')?.textContent).toBe('What the game gets')
    expect(sources(s, '[data-side="left"]')).toEqual(['/api/images/inn/current'])
    expect(sources(s, '[data-side="right"]')).toEqual(['/api/images/inn/takes/3/game'])
    expect(sources(s, '[data-strip]')).toEqual([
      '/api/images/inn/takes/2/game',
      '/api/images/inn/takes/3/game',
    ])
    expect(captions(s, 'right')).toEqual(['320 × 200'])
  })

  it('gives the game’s picture its own size once it loads, as one made before the size changed', async () => {
    const s = await show(view({ takes: [take(1, { chosen: true }), take(2, { look: 'old' })] }), {
      width: 1920,
      height: 1080,
    })
    const pictures = [
      ...s.container.querySelectorAll<HTMLImageElement>('[data-side] .look-side img'),
    ]
    expect(pictures).toHaveLength(2)
    await act(async () => {
      for (const picture of pictures) {
        Object.defineProperty(picture, 'naturalWidth', { value: 480 })
        Object.defineProperty(picture, 'naturalHeight', { value: 360 })
        picture.dispatchEvent(new Event('load'))
      }
    })
    expect([...captions(s, 'left'), ...captions(s, 'right')]).toEqual(['480 × 360', '480 × 360'])
    expect(pictures.map((p) => p.style.aspectRatio)).toEqual(['480 / 360', '480 / 360'])
  })

  it('keeps the game’s picture’s own size when the box is cleared and ticked again', async () => {
    const s = await show(view({ takes: [take(1, { chosen: true }), take(2, { look: 'old' })] }), {
      width: 1920,
      height: 1080,
    })
    const right = s.container.querySelector<HTMLImageElement>('[data-side="right"] img')!
    await act(async () => {
      Object.defineProperty(right, 'naturalWidth', { value: 480 })
      Object.defineProperty(right, 'naturalHeight', { value: 360 })
      right.dispatchEvent(new Event('load'))
    })
    await s.click(box(s))
    await s.click(box(s))
    expect(captions(s, 'right')).toEqual(['480 × 360'])
  })

  it('draws a game picture smaller than the image with hard pixels when it is enlarged', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    cleanups.push(() => {
      act(() => root.unmount())
      container.remove()
    })
    const big = { ...row, width: 1920, height: 1080 }
    act(() =>
      root.render(
        createElement(TakePicture, {
          id: 'inn',
          take: take(2, { look: 'old' }),
          row: big,
          lookError: null,
          showing: 'game',
          zoom: 0.5,
        }),
      ),
    )
    const picture = container.querySelector<HTMLImageElement>('img')!
    expect(picture.style.imageRendering).toBe('auto')
    await act(async () => {
      Object.defineProperty(picture, 'naturalWidth', { value: 480 })
      Object.defineProperty(picture, 'naturalHeight', { value: 360 })
      picture.dispatchEvent(new Event('load'))
    })
    expect(picture.style.width).toBe('960px')
    expect(picture.style.imageRendering).toBe('pixelated')
  })

  it('shows what the model made for every take when the box is cleared, and back when it is ticked', async () => {
    const s = await show(
      view({ takes: [take(1, { chosen: true }), take(2), take(3, { width: 1280, height: 720 })] }),
    )
    await s.click(box(s))
    expect(box(s).checked).toBe(false)
    expect(sources(s, '[data-side="left"]')).toEqual(['/api/images/inn/takes/1'])
    expect(sources(s, '[data-side="right"]')).toEqual(['/api/images/inn/takes/3'])
    expect(sources(s, '[data-strip]')).toEqual([
      '/api/images/inn/takes/2',
      '/api/images/inn/takes/3',
    ])
    expect(captions(s, 'right')).toEqual(['1280 × 720'])
    expect(imgs(s, 'right')[0]!.alt).toBe('Take 3, what the model made')
    await s.click(box(s))
    expect(sources(s, '[data-side="right"]')).toEqual(['/api/images/inn/takes/3/game'])
    expect(imgs(s, 'right')[0]!.alt).toBe('Take 3, what the game gets')
  })

  it('says the model’s picture is cropped to fit when it has another shape', async () => {
    const s = await show(view({ takes: [take(4, { width: 1024, height: 1024, cropped: true })] }))
    await s.click(box(s))
    expect(s.text()).toContain('1024 × 1024 · cropped to fit')
  })

  it('shows the picture the game has now for the chosen take, tagging an old look', async () => {
    const s = await show(view({ takes: [take(1, { chosen: true })] }), { looksOld: true })
    expect(sources(s, '[data-side="left"]')).toEqual(['/api/images/inn/current'])
    expect(s.container.querySelector('[data-side="left"]')?.textContent).toContain('Chosen')
    expect(s.container.querySelector('[data-side="left"]')?.textContent).toContain('Old look')
  })

  it('says it is bringing the take to the look, and cannot be chosen until it is done', async () => {
    const s = await show(view({ takes: [take(5, { look: 'bringing' })] }))
    expect(s.text()).toContain("Bringing to the game's look…")
    expect(imgs(s, 'right')).toHaveLength(0)
    expect(sources(s, '[data-strip]')).toEqual([])
    expect(isOff(s.button('Choose'))).toBe(true)
    await s.click(box(s))
    expect(sources(s, '[data-side="right"]')).toEqual(['/api/images/inn/takes/5'])
    expect(s.text()).not.toContain("Bringing to the game's look…")
  })

  it('shows what to fix in place of the game’s version, and turns Choose off', async () => {
    const message =
      "Can't bring this take to the game's look: the style's palette has a colour that isn't one: palette 3, “#7fb0e”."
    const s = await show(view({ takes: [take(3, { look: 'old' })], lookError: message }))
    expect(s.container.querySelector('[role="alert"]')?.textContent).toBe(message)
    expect(imgs(s, 'right')).toHaveLength(0)
    expect(s.text()).toContain('Fix the style to choose this take.')
    expect(isOff(s.button('Choose'))).toBe(true)
  })

  it('shows a place for a take never brought to the look, instead of a missing picture', async () => {
    const s = await show(view({ takes: [take(2, { look: 'missing' })] }))
    expect(imgs(s, 'right')).toHaveLength(0)
    expect(s.text()).toContain("Not brought to the game's look yet.")
    expect(isOff(s.button('Choose'))).toBe(false)
  })

  it('leaves Choose on when the game’s version is ready', async () => {
    const s = await show(view({ takes: [take(3)] }))
    expect(isOff(s.button('Choose'))).toBe(false)
    expect(s.text()).not.toContain('Fix the game')
  })

  it('puts Drop and Choose under the compared picture, and Un-choose under the chosen one', async () => {
    const s = await show(view({ takes: [take(1, { chosen: true }), take(2)] }))
    const after = (side: string, text: string) => {
      const picture = s.container.querySelector(`[data-side="${side}"] img`)!
      const button = s.button(text)
      return !!(picture.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING)
    }
    expect(after('right', 'Drop')).toBe(true)
    expect(after('right', 'Choose')).toBe(true)
    expect(after('left', 'Un-choose')).toBe(true)
  })

  it('has no box before there are takes', async () => {
    const s = await show(view())
    expect(s.container.querySelector('input[type="checkbox"]')).toBeNull()
  })
})

describe('the workbench', () => {
  const tools = (s: { container: HTMLElement }) =>
    s.container.querySelector('.image-workbench-tools')!

  it('keeps the prompt, Make and the other takes in one column, and the two pictures in another', async () => {
    const prompt = createElement('section', { className: 'panel', 'aria-label': 'Prompt' }, 'words')
    const s = await show(view({ takes: [take(1, { chosen: true }), take(2), take(3)] }), {}, prompt)
    const column = [...tools(s).children].map((c) => c.getAttribute('aria-label'))
    expect(column).toEqual(['Prompt', 'Make takes', 'Takes'])
    const make = tools(s).querySelector('[aria-label="Make takes"]')!
    expect(make.querySelector('select[aria-label="Model for new takes"]')).not.toBeNull()
    expect(make.querySelector('select[aria-label="Number of new takes"]')).not.toBeNull()
    expect(make.textContent).toContain('Make 2 more takes')
    expect(tools(s).querySelectorAll('[data-strip] button')).toHaveLength(2)
    const stage = s.container.querySelector('.image-stage')!
    expect(tools(s).contains(stage)).toBe(false)
    expect(stage.querySelector('[data-side="left"]')).not.toBeNull()
    expect(stage.querySelector('[data-side="right"]')).not.toBeNull()
  })

  it('has Make in its column before there are takes, and one make button only', async () => {
    const s = await show(view())
    expect(tools(s).querySelector('[aria-label="Make takes"]')?.textContent).toContain(
      'Make 2 takes',
    )
    expect(s.buttons('Make 2 takes')).toHaveLength(1)
  })

  it('counts the other takes in the heading of their list', async () => {
    const s = await show(view({ takes: [take(1, { chosen: true }), take(2), take(3)] }))
    expect(tools(s).querySelector('[aria-label="Takes"] h2')?.textContent).toBe('Takes · 2')
  })

  const changes = (s: { calls: { url: string; method: string }[] }) =>
    s.calls
      .filter((c) => c.method !== 'GET' && !c.url.endsWith('/seen'))
      .map((c) => `${c.method} ${c.url}`)

  it('C chooses the take on the right', async () => {
    const s = await show(view({ takes: three }))
    await s.key('c')
    expect(changes(s)).toEqual(['POST /api/images/inn/choose'])
    expect(s.calls.at(-1)).toMatchObject({ body: { n: 3 } })
  })

  it('D drops the take on the right', async () => {
    const s = await show(view({ takes: three }))
    await s.key('d')
    expect(changes(s)).toEqual(['DELETE /api/images/inn/takes/3'])
  })

  it('does nothing more while C or D is held down', async () => {
    const s = await show(view({ takes: three }))
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'd', repeat: true, bubbles: true }),
      )
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'c', repeat: true, bubbles: true }),
      )
    })
    expect(changes(s)).toEqual([])
  })

  it('drops one take only for two presses of D before the first has settled', async () => {
    const s = await show(view({ takes: three }))
    let answer = () => {}
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      s.calls.push({ url: String(url), method: init?.method ?? 'GET', body: undefined })
      if (init?.method === 'DELETE') await new Promise<void>((done) => (answer = done))
      return Response.json({ ok: true })
    }) as typeof fetch
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }))
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }))
    })
    expect(changes(s)).toEqual(['DELETE /api/images/inn/takes/3'])
    await act(async () => answer())
  })

  it('hears the keys while the box is focused', async () => {
    const s = await show(view({ takes: three }))
    await s.key('c', s.container.querySelector('input[type="checkbox"]')!)
    expect(changes(s)).toEqual(['POST /api/images/inn/choose'])
  })

  it('brings the thumb of the take stepped to into view', async () => {
    const s = await show(view({ takes: three }))
    const seen: string[] = []
    const real = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      seen.push(this.textContent ?? '')
    }
    cleanups.push(() => (HTMLElement.prototype.scrollIntoView = real))
    await s.key('ArrowLeft')
    expect(seen.at(-1)).toBe('Take 2')
  })

  it('keeps the words being written in the prompt while the takes come and go', async () => {
    function Draft() {
      const [words, setWords] = useState('')
      return createElement('textarea', {
        'aria-label': 'Prompt',
        value: words,
        onChange: (e: { target: { value: string } }) => setWords(e.target.value),
      })
    }
    const s = await show({ ok: false } as unknown as ImageTakesView, {}, createElement(Draft))
    const field = s.container.querySelector('textarea')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(field, 'a new inn')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      s.client.setQueryData(['image-takes', 'inn'], view({ takes: three }))
      // The query tells the page on its next turn.
      await new Promise((done) => setTimeout(done, 0))
    })
    expect(s.text()).toContain('Takes · 3')
    expect(s.container.querySelector('textarea')).toBe(field)
    expect(field.value).toBe('a new inn')
  })

  it('hears C, D and the arrows anywhere on the page, not only inside the workbench', async () => {
    const s = await show(view({ takes: three }))
    await s.key('ArrowLeft', document.body)
    expect(s.right()).toBe('Take 2')
    await s.key('c', document.body)
    expect(s.calls.at(-1)).toMatchObject({ url: '/api/images/inn/choose', body: { n: 2 } })
  })

  it('leaves the keys alone while a key is held with Command or Control', async () => {
    const s = await show(view({ takes: three }))
    const before = s.calls.length
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }),
      )
    })
    expect(s.calls.slice(before).filter((c) => c.method !== 'GET')).toEqual([])
  })

  it('leaves C and D to the words being typed', async () => {
    const prompt = createElement('textarea', { 'aria-label': 'Prompt' })
    const s = await show(view({ takes: three }), {}, prompt)
    const before = s.calls.length
    await s.key('c', s.container.querySelector('textarea')!)
    await s.key('d', s.container.querySelector('textarea')!)
    expect(s.calls.slice(before).filter((c) => c.method !== 'GET')).toEqual([])
  })

  it('shows the prompt while the takes cannot be listed', async () => {
    const prompt = createElement('section', { 'aria-label': 'Prompt' }, 'the words')
    const s = await show({ ok: false } as unknown as ImageTakesView, {}, prompt)
    expect(s.text()).toContain('the words')
    expect(s.text()).toContain('The takes could not be listed.')
  })

  it('does not choose with C when Choose is off', async () => {
    const s = await show(view({ takes: three, lockUnread: true }))
    await s.key('c')
    await s.key('d')
    expect(s.calls.filter((c) => c.method !== 'GET' && !c.url.endsWith('/seen'))).toEqual([])
  })
})

describe('saving an image’s words', () => {
  it('reloads its takes, so earlier ones are marked at once', async () => {
    const s = await show(view({ takes: three }))
    const asked: unknown[] = []
    const real = s.client.invalidateQueries.bind(s.client)
    s.client.invalidateQueries = ((filters: { queryKey?: unknown[] }) => {
      asked.push(filters?.queryKey?.[0])
      return real(filters as never)
    }) as typeof s.client.invalidateQueries
    function Saver() {
      const save = useSetImageWords('inn')
      return createElement('button', { onClick: () => save.mutate('new words') }, 'Save')
    }
    const holder = document.createElement('div')
    document.body.append(holder)
    const root = createRoot(holder)
    cleanups.push(() => act(() => root.unmount()))
    act(() =>
      root.render(createElement(QueryClientProvider, { client: s.client }, createElement(Saver))),
    )
    await act(async () => {
      holder.querySelector('button')!.click()
    })
    await act(async () => {})
    expect(asked).toContain('image-takes')
  })
})
