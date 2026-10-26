import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { CharacterLanguage, ProjectSummary } from '../../../core/summary'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { CharacterView } = await import('./CharacterView')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

/** The keeper, uncast and with no lines yet, in a project with one language. */
const uncast: CharacterLanguage = {
  voice: null,
  voiceName: null,
  speed: null,
  phrase: null,
  appearances: [],
  totalLines: 0,
  longest: null,
}
const summary: ProjectSummary = {
  name: 'Test Game',
  description: '',
  root: '/game',
  partLabel: 'Act',
  languages: [{ id: 'en', name: 'English' }],
  charactersPath: 'tts/cast.json',
  parts: [],
  characters: [
    {
      id: 'keeper',
      name: 'Keeper',
      voice: null,
      voiceName: null,
      style: '',
      speed: null,
      keywords: [],
      appearances: [],
      totalLines: 0,
      languages: { en: uncast },
    },
  ],
  canRefresh: false,
  pronounce: [],
  soundAlike: [],
  perLanguage: {},
  models: { draft: 's2.1-pro', final: 's2.1-pro' },
  speed: 1,
  projectFile: 'audio-studio.json',
  problems: [],
}

/** The studio as the page meets it: no audition going on for the keeper, nothing else known. */
const studio = (async (path: string) =>
  path.startsWith('/api/auditions/keeper')
    ? Response.json({ ok: true, session: null, audition: null, takes: {} })
    : new Response('', { status: 404 })) as unknown as typeof fetch

/** Waits until `ready` holds, letting React and the stubbed studio answer meanwhile. */
async function until(ready: () => boolean) {
  for (let i = 0; i < 100 && !ready(); i++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
  }
  expect(ready()).toBe(true)
}

describe('CharacterView', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    document.body.innerHTML = ''
  })

  it('gives focus back to Design a voice… when Escape closes the design box', async () => {
    globalThis.fetch = studio
    const container = document.createElement('div')
    document.body.append(container)
    const page = createRoot(container)
    await act(() =>
      page.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          createElement(CharacterView, { summary, characterId: 'keeper' }),
        ),
      ),
    )
    const design = () =>
      [...container.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Design a voice…'),
      )!
    await until(() => !design().disabled)

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
})
