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
async function rendered(voice: Voice, waits?: 'money' | 'credits' | 'more-credits') {
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

  it('keeps a Fish voice’s popularity, take and sample', async () => {
    const { text, buttons } = await rendered({ ...george, id: 'g1', uses: 1200, likes: 3 })
    expect(text).toContain('1.2k uses · 3 likes')
    expect(text).toContain('Fish sample')
    expect(buttons).toEqual(['Record take', 'Play Fish’s sample of George'])
  })
})
