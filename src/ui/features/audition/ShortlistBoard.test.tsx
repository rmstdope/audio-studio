import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { startSession } from '../../../core/audition'
import type { CharacterSummary } from '../../../core/summary'
import type { Voice } from '../../../core/voiceSearch'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider, useQuery } = await import('@tanstack/react-query')
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
function Board({ current = null, hear = [] }: { current?: Voice | null; hear?: Voice[] }) {
  const session = startSession({
    character: 'keeper',
    keywords: [],
    current,
    candidates: hear.map((voice) => ({ voice, matched: [] })),
    perRound: 4,
  })
  const audition = current
    ? { phrase: 'Hello there.', from: 'own' as const, standard: false, spoken: 'Hello there.' }
    : null
  // Read from the cache, as the page reads it, so takes recorded show on the board.
  const first = { ok: true as const, session, audition, takes: {} as Record<string, string> }
  const cached = useQuery({
    queryKey: ['session', 'keeper', ''],
    queryFn: () => first,
    initialData: first,
    staleTime: Infinity,
  })
  const view = cached.data.ok && cached.data.session ? cached.data : first
  return createElement(ShortlistBoard, {
    characterId: 'keeper',
    character: keeper,
    languages: [{ id: 'en', name: 'English' }],
    language: null,
    name: 'Keeper',
    lines: 0,
    designStart: 'A calm, slow old voice, worn by the sea wind.',
    view: view as typeof first,
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

  /** A studio for the keeper's board: its sitting's money and credits, and what was asked of it. */
  function studio({
    paid = false,
    dollars = null as { dollars: number; left: number } | null,
    credits = null as { dollars: number; left: number } | null,
    addRefused = null as string | null,
    slots = null as { used: number; limit: number } | null,
    freeable = [] as { voice: string; name: string; character: string }[],
    takesAdd = false,
  } = {}) {
    const asked: { method: string; path: string; body: unknown }[] = []
    const money = (given: { dollars: number; left: number } | null, perTake: number) =>
      given && {
        dollars: given.dollars,
        spent: given.dollars - given.left,
        left: given.left,
        takesLeft: Math.floor(given.left / perTake),
        usedUp: given.left < perTake,
      }
    globalThis.fetch = (async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      asked.push({ method, path, body })
      if (path.includes('/sitting/add')) {
        if (addRefused) return Response.json({ ok: false, reason: 'credits', message: addRefused })
        if ('credits' in body) {
          credits = {
            dollars: (credits?.dollars ?? 0) + body.credits,
            left: (credits?.left ?? 0) + body.credits,
          }
        }
      }
      if (path.includes('/sitting') && method === 'DELETE') credits = dollars = null
      if (path.includes('/sitting')) {
        return Response.json({
          ok: true,
          model: paid ? 's2.1-pro' : 's2.1-pro-free',
          paid,
          perTake: paid ? 0.002 : 0,
          suggested: 0.1,
          spentBefore: 0,
          sitting: money(dollars, 0.002),
          eleven: { model: 'eleven_v3', perTake: 42, suggested: 2100, sitting: money(credits, 42) },
        })
      }
      if (path.includes('/takes') && takesAdd && slots) {
        // A library voice's take adds it, using a slot.
        slots = { ...slots, used: slots.used + 1 }
        return Response.json({
          ok: true,
          key: `k-${body.voice}`,
          spoken: 'Hello there.',
          credits: 42,
        })
      }
      if (path.includes('/takes')) {
        return Response.json({
          ok: false,
          reason: 'waits',
          message: 'Take waits for more credits.',
        })
      }
      if (path === '/api/credit') return Response.json({ ok: true, credit: 25 })
      if (path === '/api/elevenlabs/account' && slots) {
        // ElevenLabs takes a moment to answer: the board must not act on the old count meanwhile.
        if (takesAdd) await new Promise((resolve) => setTimeout(resolve, 150))
        return Response.json({
          account: {
            ok: true,
            account: {
              tier: 'starter',
              charactersUsed: 0,
              characterLimit: 30000,
              renewsAt: null,
              overage: 0,
              voiceSlots: slots,
            },
          },
          held: 0,
        })
      }
      if (path === '/api/elevenlabs/voices/freeable') {
        return Response.json({ ok: true, voices: freeable })
      }
      if (path === '/api/elevenlabs/voices/free') {
        freeable = []
        if (slots) slots = { ...slots, used: slots.used - body.voices.length }
        return Response.json({ ok: true, freed: ['Rasp'], failed: [] })
      }
      return new Response('', { status: 404 })
    }) as unknown as typeof fetch
    return asked
  }

  /** Renders the keeper's board with `current` cast; its container and how to find a button. */
  async function boardOf(current: Voice, hear: Voice[] = []) {
    const container = document.createElement('div')
    document.body.append(container)
    const page = createRoot(container)
    await act(() =>
      page.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          createElement(Board, { current, hear }),
        ),
      ),
    )
    const button = (label: string) =>
      [...container.querySelectorAll('button, a')].find((b) => b.textContent?.includes(label)) as
        HTMLElement | undefined
    return { container, page, button }
  }

  it('brings in more from the library the switch names, Fish’s first', async () => {
    const asked = studio()
    const { container, page, button } = await boardOf({ ...george, id: 'f1', title: 'Old Wizard' })
    const more = () => asked.filter((a) => a.path.includes('/more')).map((a) => a.body)
    await act(() => button('Bring in more')!.click())
    await until(() => more().length === 1)
    const eleven = [...container.querySelectorAll('[aria-label="Whose library"] input')][1]!
    await act(() => (eleven as HTMLInputElement).click())
    await act(() => button('Bring in more')!.click())
    await until(() => more().length === 2)
    expect(more()).toEqual([{ provider: 'fish' }, { provider: 'elevenlabs' }])
    await act(() => page.unmount())
  })

  it('makes a library voice’s take wait for a free slot, and records it once one is freed', async () => {
    const gravel = {
      ...george,
      id: 'eleven:l1',
      title: 'Gravel',
      library: { owner: 'o', added: false },
    }
    const asked = studio({
      credits: { dollars: 2100, left: 2100 },
      slots: { used: 10, limit: 10 },
      freeable: [{ voice: 'eleven:r2', name: 'Rasp', character: 'wizard' }],
    })
    const { container, page, button } = await boardOf(gravel)
    await until(() => container.textContent!.includes('Take waits for a free voice slot'))
    expect(container.textContent).toContain('All 10 ElevenLabs voice slots are used')
    const takes = () => asked.filter((a) => a.path.includes('/takes'))
    expect(takes()).toEqual([])
    await until(() => button('Free 1 voice slot') !== undefined)
    await act(() => button('Free 1 voice slot')!.click())
    expect(container.textContent).toContain('Removes Rasp from your ElevenLabs voices.')
    const confirm = [...container.querySelectorAll('[role="alertdialog"] button')].find((b) =>
      b.textContent?.includes('Free 1 voice slot'),
    ) as HTMLElement
    await act(() => confirm.click())
    await until(() => takes().length === 1)
    expect(asked.find((a) => a.path === '/api/elevenlabs/voices/free')?.body).toEqual({
      voices: ['eleven:r2'],
    })
    expect(takes()[0]!.body).toEqual({ voice: 'eleven:l1', board: true })
    await until(() => container.textContent!.includes('ElevenLabs voice slots: 9 of 10 used'))
    await act(() => page.unmount())
  })

  it('starts no second library voice on the last slot while the first one’s take may have taken it', async () => {
    const library = { owner: 'o', added: false }
    const gravel = { ...george, id: 'eleven:l1', title: 'Gravel', library }
    const brook = { ...george, id: 'eleven:l2', title: 'Brook', library }
    const asked = studio({
      credits: { dollars: 2100, left: 2100 },
      slots: { used: 9, limit: 10 },
      takesAdd: true,
    })
    const { container, page } = await boardOf(gravel, [brook])
    const takes = () =>
      asked.filter((a) => a.path.includes('/takes')).map((a) => (a.body as { voice: string }).voice)
    await until(() => container.textContent!.includes('All 10 ElevenLabs voice slots are used'))
    // Let the board settle: Brook is never asked for.
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)))
    expect(takes()).toEqual(['eleven:l1'])
    expect(container.textContent).toContain('Take waits for a free voice slot')
    await act(() => page.unmount())
  })

  it('says when the credits are used, and adds more with Add', async () => {
    const asked = studio({ credits: { dollars: 2100, left: 20 } })
    const { container, page, button } = await boardOf(george)
    await until(() =>
      container.textContent!.includes(
        'The 2,100 credits for this audition are used. 1 voice on the board has no take yet.',
      ),
    )
    expect(container.textContent).toContain('Take waits for more credits')
    const takes = () => asked.filter((a) => a.path.includes('/takes')).length
    const before = takes()
    await act(() => button('Use up to 2,100 more credits')!.click())
    await until(() => takes() > before)
    expect(asked.find((a) => a.path.includes('/sitting/add'))?.body).toEqual({ credits: 2100 })
    await act(() => page.unmount())
  })

  it('shows why credits were refused in the bar', async () => {
    studio({ addRefused: 'Your plan has only 300 credits left.' })
    const { container, page, button } = await boardOf(george)
    await until(() => button('Use up to 2,100 credits') !== undefined)
    await act(() => button('Use up to 2,100 credits')!.click())
    await until(() => container.textContent!.includes('Your plan has only 300 credits left.'))
    await act(() => page.unmount())
  })

  it('never asks for credits with only Fish voices on the board', async () => {
    const asked = studio()
    const { container, page } = await boardOf({ ...george, id: 'f1', title: 'Old Wizard' })
    await until(() => asked.some((a) => a.path.includes('/takes')))
    expect(container.textContent).not.toContain('credits')
    await act(() => page.unmount())
  })

  it('asks for a paid model’s dollars before the credits, and shows both meters once given', async () => {
    studio({ paid: true })
    const first = await boardOf(george)
    await until(() => first.container.textContent!.includes('Carry on on s2.1-pro?'))
    expect(first.container.textContent).not.toContain('wait for credits')
    expect(first.container.textContent).not.toContain('waits for credits on')
    expect(first.container.querySelector('[aria-label="Credits for ElevenLabs voices"]')).toBeNull()
    await act(() => first.page.unmount())

    studio({
      paid: true,
      dollars: { dollars: 0.1, left: 0.1 },
      credits: { dollars: 2100, left: 2100 },
    })
    const second = await boardOf(george)
    await until(() => second.container.textContent!.includes('0 of 2,100 credits used'))
    expect(second.container.textContent).toContain('$0.00 of $0.10 used')
    await act(() => second.page.unmount())
  })

  it('ends a sitting that has only credits on Pause', async () => {
    const asked = studio({ credits: { dollars: 2100, left: 2100 } })
    const { container, page, button } = await boardOf(george)
    await until(() => container.textContent!.includes('0 of 2,100 credits used'))
    await act(() => button('Pause')!.click())
    await until(() => asked.some((a) => a.method === 'DELETE' && a.path.includes('/sitting')))
    await act(() => page.unmount())
  })
})
