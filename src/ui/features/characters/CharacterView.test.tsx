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
  takeFade: 0.2,
  projectFile: 'audio-studio.json',
  music: null,
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

  it('shows an ElevenLabs voice as ElevenLabs gives it, with its preview and a take on ElevenLabs', async () => {
    const cast: CharacterLanguage = { ...uncast, voice: 'eleven:g1', voiceName: 'George' }
    const castSummary: ProjectSummary = {
      ...summary,
      characters: summary.characters.map((c) => ({
        ...c,
        voice: 'eleven:g1',
        voiceName: 'George',
        languages: { en: cast },
      })),
    }
    const posted: string[] = []
    globalThis.fetch = (async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') posted.push(path)
      if (path.startsWith('/api/characters/keeper/voice')) {
        return Response.json({
          ok: true,
          id: 'eleven:g1',
          voice: {
            id: 'eleven:g1',
            title: 'George',
            description: 'Warm storyteller',
            tags: [],
            languages: ['en'],
            uses: 0,
            likes: 0,
            author: '',
            sample: { text: '', audio: 'https://example.com/george.mp3' },
          },
          lookup: null,
          take: null,
          audition: { spoken: 'Come in.', phrase: 'Come in.', from: 'own', standard: false },
          language: 'en',
          eleven: { model: 'eleven_flash_v2_5', credits: 4, cuesLeftOut: true },
        })
      }
      return studio(path)
    }) as unknown as typeof fetch
    const container = document.createElement('div')
    document.body.append(container)
    const page = createRoot(container)
    await act(() =>
      page.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          createElement(CharacterView, { summary: castSummary, characterId: 'keeper' }),
        ),
      ),
    )
    const panel = () => container.querySelector('[aria-label="Voice"]')?.textContent ?? ''
    await until(() => panel().includes('Warm storyteller'))
    expect(panel()).toContain('ElevenLabs voice')
    expect(panel()).not.toContain('uses')
    expect(panel()).toContain('Recorded with Flash v2.5, without asking first: about 4 credits.')
    expect(panel()).toContain('Flash v2.5 speaks cues aloud, so the take is without the style.')
    expect(panel()).not.toContain('free model')
    expect(panel()).toContain('ElevenLabs preview')
    expect(panel()).not.toContain('Open on Fish Audio')
    const labels = [...container.querySelectorAll('[aria-label="Voice"] button')].map(
      (b) => b.getAttribute('aria-label') ?? b.textContent,
    )
    expect(labels).toContain('Play ElevenLabs’ preview')
    expect(labels).toContain('Record')

    await act(() => page.unmount())
  })

  it('says why an ElevenLabs voice set to a speed ElevenLabs does not take is not recorded', async () => {
    const fast: CharacterLanguage = {
      ...uncast,
      voice: 'eleven:g1',
      voiceName: 'George',
      speed: 1.5,
    }
    const fastSummary: ProjectSummary = {
      ...summary,
      characters: summary.characters.map((c) => ({
        ...c,
        voice: 'eleven:g1',
        voiceName: 'George',
        speed: 1.5,
        languages: { en: fast },
      })),
    }
    globalThis.fetch = studio
    const container = document.createElement('div')
    document.body.append(container)
    const page = createRoot(container)
    await act(() =>
      page.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          createElement(CharacterView, { summary: fastSummary, characterId: 'keeper' }),
        ),
      ),
    )
    const delivery = () => container.querySelector('[aria-label="Delivery"]')?.textContent ?? ''
    await until(() => delivery() !== '')
    expect(delivery()).toContain(
      'ElevenLabs speaks at 0.7 to 1.2 times its pace, and this voice is set to 1.5; change its speed to record it.',
    )

    await act(() => page.unmount())
  })
})
