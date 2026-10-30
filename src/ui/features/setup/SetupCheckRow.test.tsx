import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { SetupCheck } from '../../../core/setup'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { SetupCheckRow } = await import('./SetupView')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

function render(check: SetupCheck) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(SetupCheckRow, { check }),
      ),
    ),
  )
  return container
}

const steps: NonNullable<SetupCheck['steps']> = {
  list: [
    {
      parts: [
        'Sign in and accept the licence on ',
        { link: 'stabilityai/a', href: 'https://huggingface.co/stabilityai/a' },
        '.',
      ],
    },
    { parts: ['Download:'], commands: ['HF_TOKEN=… get a', 'HF_TOKEN=… get b'] },
  ],
  note: 'The studio never asks for or keeps your token.',
}

describe('a setup row with steps', () => {
  const check: SetupCheck = {
    id: 'stableAudio',
    title: 'Music generator (Stable Audio Open)',
    state: 'off',
    label: 'Not set up',
    detail: 'Optional.',
    steps,
  }

  it('says its own word in place of the state’s', () => {
    const row = render(check)
    expect(row.querySelector('.setup-state')!.textContent).toBe('Not set up')
    expect(render({ ...check, label: undefined }).querySelector('.setup-state')!.textContent).toBe(
      'Not used',
    )
  })

  it('numbers the steps, links the pages, and shows each command', () => {
    const row = render(check)
    const items = [...row.querySelectorAll('ol.setup-steps > li')]
    expect(items.map((li) => li.firstChild!.textContent)).toEqual([
      'Sign in and accept the licence on stabilityai/a.',
      'Download:',
    ])
    const link = row.querySelector('a')!
    expect(link.getAttribute('href')).toBe('https://huggingface.co/stabilityai/a')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noreferrer')
    expect([...row.querySelectorAll('code')].map((c) => c.textContent)).toEqual([
      'HF_TOKEN=… get a',
      'HF_TOKEN=… get b',
    ])
    expect(row.textContent).toContain('The studio never asks for or keeps your token.')
  })

  it('has neither list nor note without steps', () => {
    const row = render({ ...check, steps: undefined })
    expect(row.querySelector('ol')).toBeNull()
  })
})

describe('a setup row with notes', () => {
  it('shows each note as a line of its own under what was found', () => {
    const container = render({
      id: 'elevenlabs',
      title: 'ElevenLabs',
      state: 'ok',
      detail: 'Answers. Starter plan: 27,450 of 30,000 credits left.',
      notes: ['Voice slots: 3 of 10 used.', 'Music made with ElevenLabs may be used in a game.'],
    })
    const notes = [...container.querySelectorAll('.setup-notes li')].map((li) => li.textContent)
    expect(notes).toEqual([
      'Voice slots: 3 of 10 used.',
      'Music made with ElevenLabs may be used in a game.',
    ])
    expect(container.querySelector('.setup-text .muted')!.textContent).toBe(
      'Answers. Starter plan: 27,450 of 30,000 credits left.',
    )
  })
})

describe('a setup row with failed takes', () => {
  const failing: SetupCheck = {
    id: 'imageModels',
    title: 'Image models',
    state: 'problem',
    detail: '',
    failures: [
      {
        sentence: 'The last take with FLUX.2 klein 4B failed on Bridge at dusk.',
        error: 'FileNotFoundError: No safetensors',
        link: { text: 'Open Bridge at dusk', href: '#/images/items/bridge' },
        clears: 'This clears when a take with FLUX.2 klein 4B works.',
      },
      {
        sentence: 'The last take with Z-Image-Turbo failed.',
        error: 'RuntimeError: out of memory',
        clears: 'This clears when a take with Z-Image-Turbo works.',
      },
    ],
  }

  it('shows each failure: sentence, the error in a code box, the link, and what clears it', () => {
    const row = render(failing)
    const items = [...row.querySelectorAll('.setup-failure')]
    expect(items).toHaveLength(2)
    expect(items[0]!.textContent).toContain(
      'The last take with FLUX.2 klein 4B failed on Bridge at dusk.',
    )
    expect(items[0]!.querySelector('code')!.textContent).toBe('FileNotFoundError: No safetensors')
    const link = items[0]!.querySelector('a')!
    expect(link.textContent).toBe('Open Bridge at dusk')
    expect(link.getAttribute('href')).toBe('#/images/items/bridge')
    expect(items[0]!.textContent).toContain('This clears when a take with FLUX.2 klein 4B works.')
    expect(items[1]!.querySelector('a')).toBeNull()
  })

  it('has no empty detail line when the row has only failures', () => {
    expect(render(failing).querySelector('.setup-text > .muted')).toBeNull()
  })
})
