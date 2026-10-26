import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { startSession } from '../../../core/audition'
import type { CharacterSummary } from '../../../core/summary'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { useCast } = await import('../../api')
const { ShortlistBoard } = await import('./ShortlistBoard')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

/** The keeper, uncast and with no lines yet. */
const keeper: CharacterSummary = {
  id: 'keeper',
  name: 'Keeper',
  voice: null,
  voiceName: null,
  style: '',
  speed: null,
  keywords: [],
  appearances: [],
  totalLines: 0,
  languages: {},
}

/** The keeper's audition board, just started with nothing to hear. */
function Board() {
  const session = startSession({
    character: 'keeper',
    keywords: [],
    current: null,
    candidates: [],
    perRound: 4,
  })
  return createElement(ShortlistBoard, {
    characterId: 'keeper',
    character: keeper,
    languages: [{ id: 'en', name: 'English' }],
    language: null,
    name: 'Keeper',
    lines: 0,
    designStart: 'A calm, slow old voice, worn by the sea wind.',
    view: { ok: true, session, audition: null, takes: {} },
    playing: null,
    toggle: () => {},
    stop: () => {},
    cast: useCast('keeper'),
    titles: new Map(),
  })
}

/** Waits until `ready` holds, letting React and the stubbed studio answer meanwhile. */
async function until(ready: () => boolean) {
  for (let i = 0; i < 100 && !ready(); i++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
  }
  expect(ready()).toBe(true)
}

describe('ShortlistBoard', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    document.body.innerHTML = ''
  })

  it('gives focus back to Design a voice… when Escape closes the design box', async () => {
    globalThis.fetch = (async () => new Response('', { status: 404 })) as unknown as typeof fetch
    const container = document.createElement('div')
    document.body.append(container)
    const page = createRoot(container)
    await act(() =>
      page.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          createElement(Board),
        ),
      ),
    )
    const design = () =>
      [...container.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Design a voice…'),
      )!

    await act(() => design().click())
    const box = () => container.querySelector('[aria-label="Description of the voice"]')
    await until(() => box() !== null && document.activeElement === box())
    await act(() =>
      box()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    )
    // Focus comes back once the box is gone and the button is enabled again.
    await until(() => box() === null && document.activeElement === design())

    await act(() => page.unmount())
  })

  it('gives focus back to Design a voice… when a design is made', async () => {
    globalThis.fetch = (async (path: string) =>
      path === '/api/credit'
        ? Response.json({ ok: true, credit: 25 })
        : path.endsWith('/design')
          ? Response.json({ ok: true, voices: [] })
          : new Response('', { status: 404 })) as unknown as typeof fetch
    const container = document.createElement('div')
    document.body.append(container)
    const page = createRoot(container)
    await act(() =>
      page.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          createElement(Board),
        ),
      ),
    )
    const button = (label: string) =>
      [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(label))
    const design = () => button('Design a voice…')!

    await act(() => design().click())
    await act(() => button('Design voices…')!.click())
    await until(() => button('Pay up to')?.disabled === false)
    await act(() => button('Pay up to')!.click())
    // Focus comes back once the box is gone and the button is enabled again.
    await until(
      () =>
        !container.querySelector('[aria-label="Description of the voice"]') &&
        document.activeElement === design(),
    )

    await act(() => page.unmount())
  })
})
