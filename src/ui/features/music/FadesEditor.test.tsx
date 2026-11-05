import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { TakeView } from '../../../core/musicTake'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { FadesEditor } = await import('./FadesEditor')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterAll(() => {
  cleanups.forEach((c) => c())
  GlobalRegistrator.unregister()
})

const take: TakeView = {
  n: 3,
  file: 'abc.3.wav',
  seconds: 4.2,
  peaks: Array.from({ length: 40 }, () => 0.5),
  earlier: false,
  chosen: false,
  model: 'Balanced',
}

const sent: { url: string; init?: RequestInit }[] = []
let answer: Response = Response.json({ ok: true })
beforeEach(() => {
  sent.length = 0
  answer = Response.json({ ok: true })
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), init })
    return answer.clone()
  }) as typeof fetch
})

const player = {
  playing: null as string | null,
  inTurn: false,
  toggled: [] as [string, string, unknown][],
  toggle(id: string, url: string, how?: unknown) {
    this.toggled.push([id, url, how])
  },
  position: () => null,
  playInTurn() {},
  stop() {},
}

function open(over: Partial<TakeView> = {}, chosen = false) {
  const closed: string[] = []
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(FadesEditor, {
          trackId: 'victory',
          take: { ...take, ...over },
          chosen,
          player,
          onClose: () => closed.push('closed'),
        }),
      ),
    ),
  )
  const q = (selector: string) => container.querySelector(selector)
  const button = (text: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === text) as
      HTMLButtonElement | undefined
  const box = (label: string) =>
    [...container.querySelectorAll('label')]
      .find((l) => l.textContent?.startsWith(label))
      ?.querySelector('input') as HTMLInputElement
  const type = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  return { container, q, button, box, type, closed }
}

describe('the fades editor', () => {
  it('opens with focus in Fade in, both at 0, Smooth, Save greyed and no Remove', () => {
    const e = open()
    expect(document.activeElement).toBe(e.box('Fade in'))
    expect(e.box('Fade in').value).toBe('0')
    expect(e.box('Fade out').value).toBe('0')
    expect((e.q('select') as HTMLSelectElement).value).toBe('smooth')
    expect(e.button('Save fades')?.disabled).toBe(true)
    expect(e.button('Remove fades')).toBeUndefined()
    expect(e.container.textContent).toContain('Hear it with the fades')
    expect(e.container.textContent).toContain('Drag the handles or type a length; 0 is no fade.')
  })

  it('shows the chosen take’s hint', () => {
    const e = open({ chosen: true }, true)
    expect(e.container.textContent).toContain('Saving puts the faded sound in the game at once.')
  })

  it('opens a take with fades on its saved values, with Remove fades', () => {
    const e = open({ fades: { in: 0.3, out: 1.5, shape: 'straight' } })
    expect(e.box('Fade in').value).toBe('0.3')
    expect(e.box('Fade out').value).toBe('1.5')
    expect((e.q('select') as HTMLSelectElement).value).toBe('straight')
    expect(e.button('Remove fades')).toBeDefined()
    expect(e.button('Save fades')?.disabled).toBe(true)
  })

  it('says why lengths cannot be used and greys Save', () => {
    const e = open()
    e.type(e.box('Fade in'), '3')
    e.type(e.box('Fade out'), '2')
    expect(e.container.textContent).toContain(
      "The fades together can't be longer than the take (4.2 s).",
    )
    expect(e.button('Save fades')?.disabled).toBe(true)
    expect(e.box('Fade in').getAttribute('aria-invalid')).toBe('true')
    e.type(e.box('Fade out'), '')
    expect(e.container.textContent).toContain('Type a length of 0 s or more.')
    e.type(e.box('Fade out'), '-1')
    expect(e.container.textContent).toContain('Type a length of 0 s or more.')
    expect(e.button('Save fades')?.disabled).toBe(true)
  })

  it('reddens only the box that is empty or negative, but both when together they are too long', () => {
    const e = open()
    e.type(e.box('Fade in'), '')
    e.type(e.box('Fade out'), '1')
    expect(e.box('Fade in').getAttribute('aria-invalid')).toBe('true')
    expect(e.box('Fade out').getAttribute('aria-invalid')).toBeNull()
    e.type(e.box('Fade in'), '3')
    e.type(e.box('Fade out'), '3')
    expect(e.box('Fade in').getAttribute('aria-invalid')).toBe('true')
    expect(e.box('Fade out').getAttribute('aria-invalid')).toBe('true')
  })

  it('saves the lengths and the shape, and closes', async () => {
    const e = open()
    e.type(e.box('Fade in'), '0.3')
    e.type(e.box('Fade out'), '1.5')
    expect(e.button('Save fades')?.disabled).toBe(false)
    await act(async () => e.button('Save fades')!.click())
    expect(sent).toHaveLength(1)
    expect(sent[0]!.url).toBe('/api/music/tracks/victory/takes/abc.3.wav/fades')
    expect(sent[0]!.init?.method).toBe('PUT')
    expect(JSON.parse(String(sent[0]!.init?.body))).toEqual({ in: 0.3, out: 1.5, shape: 'smooth' })
    expect(e.closed).toEqual(['closed'])
  })

  it('keeps the editor open with the reason when the save fails', async () => {
    answer = Response.json({ ok: false, message: 'The disk is full.' }, { status: 409 })
    const e = open()
    e.type(e.box('Fade in'), '0.3')
    await act(async () => e.button('Save fades')!.click())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(e.closed).toEqual([])
    expect(e.container.textContent).toContain('The fades could not be saved. The disk is full.')
    expect(e.box('Fade in').value).toBe('0.3')
  })

  it('says the game still plays the take as before when a save fails on the chosen take', async () => {
    answer = Response.json({ ok: false, message: 'The disk is full.' }, { status: 409 })
    const e = open({ chosen: true }, true)
    e.type(e.box('Fade in'), '0.3')
    await act(async () => e.button('Save fades')!.click())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(e.container.textContent).toContain(
      'The fades could not be saved. The disk is full. The game still plays Take 3 as before.',
    )
  })

  it('says the game keeps its fades when a remove fails on the chosen take', async () => {
    answer = Response.json({ ok: false, message: 'The disk is full.' }, { status: 409 })
    const e = open({ chosen: true, fades: { in: 0.3, out: 0, shape: 'smooth' } }, true)
    await act(async () => e.button('Remove fades')!.click())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(e.closed).toEqual([])
    expect(e.container.textContent).toContain(
      'The fades could not be removed. The disk is full. The game still plays Take 3 with its fades.',
    )
  })

  it('claims nothing about the game when its file could not be put back', async () => {
    answer = Response.json(
      { ok: false, message: 'The disk is full.', gameChanged: true },
      { status: 409 },
    )
    const e = open({ chosen: true }, true)
    e.type(e.box('Fade in'), '0.3')
    await act(async () => e.button('Save fades')!.click())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(e.container.textContent).toContain('The fades could not be saved. The disk is full.')
    expect(e.container.textContent).not.toContain('still plays')
  })

  it('removes the fades in one press, with no question', async () => {
    const e = open({ fades: { in: 0.3, out: 0, shape: 'smooth' } })
    await act(async () => e.button('Remove fades')!.click())
    expect(sent[0]!.init?.method).toBe('DELETE')
    expect(e.closed).toEqual(['closed'])
  })

  it('cancels with the button and with Escape, and saves with Enter', async () => {
    const e = open()
    act(() => e.button('Cancel')!.click())
    expect(e.closed).toEqual(['closed'])
    const f = open()
    act(() => {
      f.box('Fade in').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(f.closed).toEqual(['closed'])
    const g = open()
    g.type(g.box('Fade in'), '0.2')
    await act(async () => {
      g.box('Fade in').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(sent).toHaveLength(1)
    // Enter does nothing while Save is greyed.
    const h = open()
    await act(async () => {
      h.box('Fade in').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(sent).toHaveLength(1)
  })

  it('moves a focused handle by 0.05 s, and by 0.5 s with Shift; the boxes follow', () => {
    const e = open()
    const handle = e.q('[aria-label="Fade in length"]') as HTMLElement
    act(() => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(e.box('Fade in').value).toBe('0.05')
    act(() => {
      handle.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
      )
    })
    expect(e.box('Fade in').value).toBe('0.55')
    const out = e.q('[aria-label="Fade out length"]') as HTMLElement
    act(() => {
      out.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    expect(e.box('Fade out').value).toBe('0.05')
  })

  it('plays the take with the fades as they stand, without the playback fade', () => {
    player.toggled.length = 0
    const e = open()
    e.type(e.box('Fade in'), '0.5')
    act(() => (e.q('button.play') as HTMLButtonElement).click())
    expect(player.toggled[0]).toEqual([
      'music-take-victory-3',
      '/api/music/tracks/victory/takes/abc.3.wav?fadeIn=0.5&fadeOut=0&shape=smooth',
      { fade: false },
    ])
  })
})
