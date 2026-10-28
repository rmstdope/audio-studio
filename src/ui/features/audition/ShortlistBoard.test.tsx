import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { startSession } from '../../../core/audition'
import type { CharacterSummary } from '../../../core/summary'
import type { Voice } from '../../../core/voiceSearch'

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

/** George, an ElevenLabs voice. */
const george: Voice = {
  id: 'eleven:g1',
  title: 'George',
  description: '',
  tags: [],
  languages: ['en'],
  uses: 0,
  likes: 0,
  author: '',
  sample: null,
}

/**
 * The keeper's audition board, just started with nothing to hear; `current` is cast and on the
 * shortlist, and a phrase is given when `current` is.
 */
function Board({ current = null }: { current?: Voice | null }) {
  const session = startSession({
    character: 'keeper',
    keywords: [],
    current,
    candidates: [],
    perRound: 4,
  })
  const audition = current
    ? { phrase: 'Hello there.', from: 'own' as const, standard: false, spoken: 'Hello there.' }
    : null
  return createElement(ShortlistBoard, {
    characterId: 'keeper',
    character: keeper,
    languages: [{ id: 'en', name: 'English' }],
    language: null,
    name: 'Keeper',
    lines: 0,
    designStart: 'A calm, slow old voice, worn by the sea wind.',
    view: { ok: true, session, audition, takes: {} },
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
          createElement(Board, {}),
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
          createElement(Board, {}),
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

  it('brings in an ElevenLabs voice by its id, with ElevenLabs chosen beside the field', async () => {
    const posted: { path: string; body: unknown }[] = []
    globalThis.fetch = (async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') posted.push({ path, body: JSON.parse(String(init.body)) })
      return new Response('', { status: 404 })
    }) as unknown as typeof fetch
    const container = document.createElement('div')
    document.body.append(container)
    const page = createRoot(container)
    await act(() =>
      page.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          createElement(Board, {}),
        ),
      ),
    )
    const field = container.querySelector<HTMLInputElement>('#voice-id')!
    const type = (text: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, text)
        field.dispatchEvent(new Event('input', { bubbles: true }))
      })
    const provider = container.querySelector<HTMLSelectElement>('[aria-label="Whose voice"]')!
    expect([...provider.options].map((o) => o.text)).toEqual(['Fish Audio', 'ElevenLabs'])
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
        provider,
        'elevenlabs',
      )
      provider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(field.placeholder).toBe('ElevenLabs voice id')
    const submit = () =>
      act(() =>
        container
          .querySelector('form.add-voice')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
      )

    await type('https://elevenlabs.io/app/voice-lab')
    await submit()
    expect(container.textContent).toContain('That is not an ElevenLabs voice id.')
    expect(posted).toEqual([])

    await type('JBFqnCBsd6RMkjVDRZzb')
    await submit()
    await until(() => posted.length > 0)
    expect(posted[0]).toMatchObject({
      path: expect.stringContaining('/api/auditions/keeper/add'),
      body: { voice: 'eleven:JBFqnCBsd6RMkjVDRZzb' },
    })

    await act(() => page.unmount())
  })

  it('asks for credits for an ElevenLabs voice, records no take without them, and records it once given', async () => {
    const posted: { path: string; body: unknown }[] = []
    const money = {
      ok: true,
      model: 's2.1-pro-free',
      paid: false,
      perTake: 0,
      suggested: 0.05,
      spentBefore: 0,
      sitting: null,
    }
    const eleven = { model: 'eleven_v3', perTake: 42, suggested: 2100 }
    let given = false
    globalThis.fetch = (async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') posted.push({ path, body: JSON.parse(String(init.body)) })
      if (path.includes('/sitting/add')) given = true
      if (path.includes('/sitting')) {
        const credits = { dollars: 2100, spent: 0, left: 2100, takesLeft: 50, usedUp: false }
        return Response.json({ ...money, eleven: { ...eleven, sitting: given ? credits : null } })
      }
      if (path === '/api/elevenlabs/account') {
        return Response.json({
          account: {
            ok: true,
            account: {
              tier: 'creator',
              charactersUsed: 1800,
              characterLimit: 50_000,
              renewsAt: null,
              overage: 0,
              voiceSlots: { used: 0, limit: 30 },
            },
          },
          held: 0,
        })
      }
      return new Response('', { status: 404 })
    }) as unknown as typeof fetch
    const container = document.createElement('div')
    document.body.append(container)
    const page = createRoot(container)
    await act(() =>
      page.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          createElement(Board, { current: george }),
        ),
      ),
    )
    const button = (label: string) =>
      [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(label))
    await until(() => container.textContent!.includes('48,200 credits left on your plan'))
    expect(container.textContent).toContain('1 ElevenLabs voice on the board waits for credits')
    expect(container.textContent).toContain('Take waits for credits')
    expect(posted.filter((p) => p.path.includes('/takes'))).toEqual([])

    await act(() => button('Use up to 2,100 credits')!.click())
    await until(() => posted.some((p) => p.path.includes('/takes')))
    expect(posted.find((p) => p.path.includes('/sitting/add'))?.body).toEqual({ credits: 2100 })
    expect(posted.find((p) => p.path.includes('/takes'))?.body).toEqual({
      voice: 'eleven:g1',
      board: true,
    })
    await until(() => container.textContent!.includes('0 of 2,100 credits used'))
    expect(container.textContent).not.toContain('waits for credits')

    await act(() => page.unmount())
  })
})
