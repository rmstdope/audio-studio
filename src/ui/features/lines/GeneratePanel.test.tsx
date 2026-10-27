import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { GenerationPlan } from '../../../core/generation'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { GeneratePanel } = await import('./GeneratePanel')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

/** A plan of one line on Fish's free model and one with an ElevenLabs voice. */
const plan: GenerationPlan = {
  keys: ['a', 'b'],
  weak: [],
  unmeasured: [],
  recheck: [],
  drafted: 0,
  untracked: 0,
  missing: 2,
  stale: {},
  uncast: [],
  untranslated: 0,
  orphans: [],
  bytes: 6,
  model: 's2.1-pro-free',
  cost: 0,
  ceiling: 0,
  eleven: { keys: ['a'], model: 'eleven_v3', characters: 5, credits: 5, ceiling: 15 },
  takes: 3,
  final: false,
  checked: false,
}
const account = {
  tier: 'starter',
  charactersUsed: 2550,
  characterLimit: 30000,
  renewsAt: null,
  overage: 0,
  voiceSlots: { used: 0, limit: 10 },
}

/** Waits until `ready` holds, letting React and the stubbed studio answer meanwhile. */
async function until(ready: () => boolean) {
  for (let i = 0; i < 100 && !ready(); i++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
  }
  expect(ready()).toBe(true)
}

describe('GeneratePanel, with lines on ElevenLabs', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    document.body.innerHTML = ''
  })

  it('shows what they take of the plan, and asks to use those credits before generating', async () => {
    const started: unknown[] = []
    globalThis.fetch = (async (path: string, init?: RequestInit) => {
      if (path.startsWith('/api/parts/act1/plan')) {
        return Response.json({ ok: true, plan, parallel: 4, elevenAccount: { ok: true, account } })
      }
      if (path.startsWith('/api/parts/act1/jobs') && init?.method === 'POST') {
        started.push(JSON.parse(String(init.body)))
        return Response.json({ error: 'stop here' }, { status: 409 })
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
          createElement(GeneratePanel, {
            partId: 'act1',
            language: null,
            speaker: null,
            models: { draft: 's2.1-pro-free', final: 's2.1-pro-free' },
          }),
        ),
      ),
    )
    await until(() => (container.textContent ?? '').includes('ElevenLabs · eleven_v3'))
    expect(container.textContent).toContain(
      'ElevenLabs · eleven_v3 · 5 characters of text · about 5 credits, at most 15 · 27,450 credits left on your plan',
    )
    const button = (label: string) =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === label)
    await act(() => button('Generate')!.click())
    await until(() => button('Use up to 15 credits') !== undefined)
    expect(started).toEqual([])
    await act(() => button('Use up to 15 credits')!.click())
    await until(() => started.length === 1)
    expect(started[0]).toMatchObject({ keys: ['a', 'b'], confirmedCredits: 15 })
    expect(started[0]).not.toHaveProperty('confirmedCost')

    await act(() => page.unmount())
  })
})
