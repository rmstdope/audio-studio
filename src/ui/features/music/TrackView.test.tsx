import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { MusicListSummary, TrackRow } from '../../../core/music'
import type { MusicTakesView, TakeView } from '../../../core/musicTake'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { TrackView } = await import('./TrackView')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const realFetch = globalThis.fetch
const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((c) => c())
  document.body.replaceChildren()
})
afterAll(() => {
  globalThis.fetch = realFetch
  GlobalRegistrator.unregister()
})

const track: TrackRow = {
  id: 'hall',
  title: 'Lantern hall',
  plays: null,
  brief: 'A brief',
  seconds: 30,
  bpm: null,
  key: null,
  game: { brief: 'A brief', seconds: 30, bpm: null, key: null },
  gameChanged: false,
  gameWas: null,
  status: 'not-chosen',
  changed: [],
  chosenAt: null,
  current: { kind: 'none' },
  gameFile: null,
}

const list: MusicListSummary = {
  id: 'act-1',
  kind: 'act',
  title: 'Act 1',
  state: 'ok',
  tracks: [track],
  orphans: [],
  dropped: 0,
  canRefresh: false,
}

const noTakes: MusicTakesView = {
  ok: true,
  kind: 'loop',
  generator: { ok: true },
  defaultModel: 'balanced',
  models: [{ id: 'balanced', installed: true }],
  takes: [],
  making: [],
  failed: [],
  lockUnread: false,
}

const oneFailed: Partial<MusicTakesView> = {
  failed: [{ n: 1, message: 'It broke.', model: 'Balanced · XL turbo · 4B', modelId: 'balanced' }],
}

const take: TakeView = {
  n: 1,
  file: 'abc.1.wav',
  seconds: 30,
  peaks: [],
  earlier: false,
  chosen: false,
  model: 'Balanced · XL turbo · 4B',
}

const saved = () => Response.json({ ok: true })

/** The track's page, its requests kept; a save of the brief answers only once `release` is called. */
function render(answer: () => Response, takes: Partial<MusicTakesView> = {}) {
  const calls: { method: string; url: string; body: unknown }[] = []
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (method !== 'PATCH') return Response.json({ ok: true })
    await held
    return answer()
  }) as typeof fetch
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(['music-takes', 'hall'], { ...noTakes, ...takes })
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(TrackView, { list, lists: [list], track }),
      ),
    ),
  )
  const button = (name: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith(name))!
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 5))))
  const asked = () => calls.filter((c) => c.method !== 'GET').map((c) => c.method)
  const takesAsked = () =>
    calls.filter((c) => c.method === 'POST' && c.url === '/api/music/tracks/hall/takes')
  const finish = async () => {
    await act(async () => release())
    await settle()
  }
  return { container, button, settle, calls, asked, takesAsked, finish }
}

type Shown = ReturnType<typeof render>

/** Types `value` in the field labelled `label` and presses `press` without leaving it first. */
async function typeAndPress(shown: Shown, label: string, value: string, press: string) {
  const fieldId = [...shown.container.querySelectorAll('label')].find(
    (l) => l.textContent === label,
  )!.htmlFor
  const field = document.getElementById(fieldId) as HTMLTextAreaElement | HTMLInputElement
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  // The press of the mouse leaves the field; the click comes before anything has rendered.
  await act(async () => {
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    shown.button(press).click()
  })
  await shown.settle()
}

const BRIEF = 'What it should sound like'
const LENGTH = 'Length (m:ss)'

describe('Make pressed straight after typing the brief', () => {
  it('asks for the takes only once the brief is saved', async () => {
    const shown = render(saved)
    await typeAndPress(shown, BRIEF, 'A new brief', 'Make 2 takes')
    expect(shown.asked()).toEqual(['PATCH'])
    await shown.finish()
    expect(shown.asked()).toEqual(['PATCH', 'POST'])
    expect(shown.takesAsked()[0]!.body).toEqual({ count: 2, model: 'balanced' })
  })

  it('waits the same way for Make more takes', async () => {
    const shown = render(saved, { takes: [take] })
    await typeAndPress(shown, BRIEF, 'A new brief', 'Make 2 more takes')
    expect(shown.asked()).toEqual(['PATCH'])
    await shown.finish()
    expect(shown.asked()).toEqual(['PATCH', 'POST'])
  })

  it('waits the same way for a changed length, which makes the take as much as the words do', async () => {
    const shown = render(saved)
    await typeAndPress(shown, LENGTH, '1:20', 'Make 2 takes')
    expect(shown.asked()).toEqual(['PATCH'])
    await shown.finish()
    expect(shown.asked()).toEqual(['PATCH', 'POST'])
  })

  it('keeps Make off while it waits, so a second press asks for nothing more', async () => {
    const shown = render(saved)
    await typeAndPress(shown, BRIEF, 'A new brief', 'Make 2 takes')
    expect(shown.button('Make 2 takes').disabled).toBe(true)
    await act(async () => shown.button('Make 2 takes').click())
    await shown.finish()
    expect(shown.takesAsked()).toHaveLength(1)
  })

  it('keeps the menus still while it waits, so the press makes what it showed', async () => {
    const shown = render(saved)
    await typeAndPress(shown, BRIEF, 'A new brief', 'Make 2 takes')
    const menus = [...shown.container.querySelectorAll('select')]
    expect(menus.map((m) => m.disabled)).toEqual([true, true])
    await shown.finish()
    expect([...shown.container.querySelectorAll('select')].map((m) => m.disabled)).toEqual([
      false,
      false,
    ])
  })

  it('makes nothing when the brief could not be saved, and says why', async () => {
    const shown = render(() =>
      Response.json({
        ok: false,
        problems: [{ file: 'edits.json', path: 'brief', message: 'Too long' }],
      }),
    )
    await typeAndPress(shown, BRIEF, 'A new brief', 'Make 2 takes')
    await shown.finish()
    expect(shown.takesAsked()).toEqual([])
    expect(shown.container.textContent).toContain('Too long')
    expect(shown.button('Make 2 takes').disabled).toBe(false)
  })

  it('makes nothing when the save itself failed', async () => {
    const shown = render(() => new Response('', { status: 500 }))
    await typeAndPress(shown, BRIEF, 'A new brief', 'Make 2 takes')
    await shown.finish()
    expect(shown.takesAsked()).toEqual([])
    expect(shown.button('Make 2 takes').disabled).toBe(false)
  })

  it('saves the brief again on another press after a failed save, then asks for the takes', async () => {
    let answers = 0
    const shown = render(() =>
      answers++ === 0 ? new Response('', { status: 500 }) : Response.json({ ok: true }),
    )
    await typeAndPress(shown, BRIEF, 'A new brief', 'Make 2 takes')
    await shown.finish()
    expect(shown.takesAsked()).toEqual([])
    await act(async () => shown.button('Make 2 takes').click())
    await shown.settle()
    expect(shown.asked()).toEqual(['PATCH', 'PATCH', 'POST'])
  })

  it('makes nothing while a length that cannot be read stays in its field, and says why', async () => {
    const shown = render(saved)
    await typeAndPress(shown, LENGTH, 'soon', 'Make 2 takes')
    await shown.settle()
    expect(shown.asked()).toEqual([])
    expect(shown.container.textContent).toContain('Use minutes and seconds, like 1:20.')
    expect(shown.button('Make 2 takes').disabled).toBe(false)
  })

  it('asks for the takes at once when nothing was typed', async () => {
    const shown = render(saved)
    await act(async () => shown.button('Make 2 takes').click())
    await shown.settle()
    expect(shown.asked()).toEqual(['POST'])
  })
})

describe('Try again pressed straight after typing the brief', () => {
  it('asks for the take only once the brief is saved', async () => {
    const shown = render(saved, oneFailed)
    await typeAndPress(shown, BRIEF, 'A new brief', 'Try again')
    expect(shown.asked()).toEqual(['PATCH'])
    await shown.finish()
    expect(shown.takesAsked()[0]!.body).toEqual({ retry: 1 })
  })

  it('makes nothing when the brief could not be saved', async () => {
    const shown = render(() => new Response('', { status: 500 }), oneFailed)
    await typeAndPress(shown, BRIEF, 'A new brief', 'Try again')
    await shown.finish()
    expect(shown.takesAsked()).toEqual([])
  })

  it('is off while a press of Make waits for the brief', async () => {
    const shown = render(saved, oneFailed)
    await typeAndPress(shown, BRIEF, 'A new brief', 'Make 2 takes')
    expect(shown.button('Try again').disabled).toBe(true)
    await shown.finish()
  })
})
