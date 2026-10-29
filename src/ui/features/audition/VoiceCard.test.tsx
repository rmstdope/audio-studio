import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Voice } from '../../../core/voiceSearch'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { VoiceCard } = await import('./VoiceCard')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

/** George, an ElevenLabs voice brought in by its id. */
const george: Voice = {
  id: 'eleven:g1',
  title: 'George',
  description: 'Warm storyteller',
  tags: ['british'],
  languages: ['en'],
  uses: 0,
  likes: 0,
  author: '',
  sample: { text: '', audio: 'https://example.com/george.mp3' },
}

/** The card's text, rendered without a take. */
async function rendered(voice: Voice, waits?: 'money' | 'credits' | 'more-credits' | 'slot') {
  const container = document.createElement('div')
  const page = createRoot(container)
  await act(() =>
    page.render(
      createElement(VoiceCard, {
        voice,
        playing: null,
        toggle: () => {},
        take: null,
        recording: false,
        error: null,
        onRecord: () => {},
        waits,
      }),
    ),
  )
  const text = container.textContent ?? ''
  const buttons = [...container.querySelectorAll('button')].map(
    (b) => b.getAttribute('aria-label') ?? b.textContent,
  )
  await act(() => page.unmount())
  return { text, buttons }
}

describe('VoiceCard, an ElevenLabs voice', () => {
  it('says whose it is, records a take and plays ElevenLabs’ preview', async () => {
    const { text, buttons } = await rendered(george)
    expect(text).toContain('ElevenLabs voice')
    expect(text).not.toContain('uses')
    expect(text).toContain('ElevenLabs preview')
    expect(buttons).toEqual(['Record take', 'Play ElevenLabs’ preview of George'])
  })

  it('says its take waits for credits, or for more of them, and offers no Record take', async () => {
    const first = await rendered(george, 'credits')
    expect(first.text).toContain('Take waits for credits')
    expect(first.buttons).toEqual(['Play ElevenLabs’ preview of George'])
    expect((await rendered(george, 'more-credits')).text).toContain('Take waits for more credits')
    expect((await rendered({ ...george, id: 'g1' }, 'money')).text).toContain(
      'Take waits for more money',
    )
  })

  it('says a library voice is from the library, how many added it, and that its first take adds it', async () => {
    const gravel = { ...george, uses: 1234, library: { owner: 'o', added: false } }
    const { text, buttons } = await rendered(gravel)
    expect(text).toContain('ElevenLabs library · added by 1.2k')
    expect(text).toContain('Its first take adds it to your ElevenLabs voices, using a voice slot.')
    expect(buttons).toEqual(['Record take', 'Play ElevenLabs’ preview of George'])
    expect((await rendered(gravel, 'credits')).text).toContain(
      'Its first take adds it to your ElevenLabs voices',
    )
    const full = await rendered(gravel, 'slot')
    expect(full.text).toContain('Take waits for a free voice slot')
    expect(full.buttons).toEqual(['Play ElevenLabs’ preview of George'])
  })

  it('says a library voice already in the user’s voices is, and that nothing is added', async () => {
    const { text } = await rendered({ ...george, library: { owner: 'o', added: true } })
    expect(text).toContain('ElevenLabs library · in your voices')
    expect(text).not.toContain('adds it')
  })

  it('keeps a Fish voice’s popularity, take and sample', async () => {
    const { text, buttons } = await rendered({ ...george, id: 'g1', uses: 1200, likes: 3 })
    expect(text).toContain('Fish Audio · 1.2k uses · 3 likes')
    expect(text).toContain('Fish sample')
    expect(buttons).toEqual(['Record take', 'Play Fish’s sample of George'])
  })
})

describe('VoiceCard, the provider on the muted line', () => {
  const fish: Voice = { ...george, id: 'g1', uses: 12000, likes: 340 }

  it('names Fish Audio first on a library voice, with or without an author', async () => {
    expect((await rendered({ ...fish, author: 'seawolf' })).text).toContain(
      'Fish Audio · by seawolf · 12k uses · 340 likes',
    )
    expect((await rendered(fish)).text).toContain('Fish Audio · 12k uses · 340 likes')
  })

  it('names the provider before Your voice · private', async () => {
    expect((await rendered({ ...fish, own: true })).text).toContain(
      'Fish Audio · Your voice · private',
    )
    expect((await rendered({ ...george, own: true })).text).toContain(
      'ElevenLabs · Your voice · private',
    )
  })

  it('names the provider before Designed · not saved, as a design’s own id does not say it', async () => {
    const design = { n: 1, description: 'a gruff voice', at: '2026-01-01T00:00:00Z' }
    const fishDesign: Voice = { ...fish, id: 'design-0123456789ab', design }
    const elevenDesign: Voice = {
      ...george,
      id: 'design-ba9876543210',
      design: { ...design, generated: 'eleven:g2' },
    }
    expect((await rendered(fishDesign)).text).toContain('Fish Audio · Designed · not saved')
    expect((await rendered(elevenDesign)).text).toContain('ElevenLabs · Designed · not saved')
  })
})
