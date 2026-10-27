import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ModelsAnswer } from '../../api'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { ModelsPanel } = await import('./ModelsPanel')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterAll(() => {
  cleanups.forEach((c) => c())
  GlobalRegistrator.unregister()
})

const installed = {
  balanced: true,
  quick: true,
  quickest: true,
  careful: true,
  short: true,
  shortest: true,
  eleven: true,
}

const answer = (music: Extract<ModelsAnswer, { ok: true }>['music']): ModelsAnswer => ({
  ok: true,
  file: 'audio-studio.json',
  models: { audition: 's2.1-pro-free', draft: 's2.1-pro-free', final: 's2.1-pro-free' },
  dialog: { lines: 0, bytes: 0 },
  recorded: {},
  music,
  busy: null,
})

let reply: () => Promise<Response>
const put: unknown[] = []
beforeEach(() => {
  put.length = 0
  reply = async () => new Response(JSON.stringify({ ok: true }))
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (init?.method === 'PUT' && String(url) === '/api/music/model') {
      put.push(JSON.parse(String(init.body)))
      return reply()
    }
    return new Response('{}')
  }) as typeof fetch
})

function render(data: ModelsAnswer) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(['models'], data)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  act(() => root.render(createElement(QueryClientProvider, { client }, createElement(ModelsPanel))))
  const menu = () => container.querySelector<HTMLSelectElement>('select[aria-label="Music model"]')
  const pick = (value: string) =>
    act(async () => {
      menu()!.value = value
      menu()!.dispatchEvent(new Event('change', { bubbles: true }))
    })
  return { container, menu, pick }
}

describe('the Music row of the Models panel', () => {
  it('is a fourth row with its purpose, one menu of whole recipes, and Free', () => {
    const page = render(answer({ model: 'balanced', installed, loops: [90, 25] }))
    const rows = [...page.container.querySelectorAll('.mrow .mname')].map((n) => n.textContent)
    expect(rows).toEqual(['Audition', 'Draft', 'Final', 'Music'])
    const text = page.container.textContent!
    expect(text).toContain(
      "Loops and stingers, made on this computer. A track's takes can use another.",
    )
    expect(text).toContain(
      'Which model records each stage of the voices, and which makes the music.',
    )
    expect(page.menu()!.value).toBe('balanced')
    expect([...page.menu()!.options].map((o) => o.textContent)).toEqual([
      'Balanced · XL turbo · 4B — about 3 min a take',
      'Quick · XL turbo · 1.7B — about 1¼ min a take',
      'Quickest · Turbo · 1.7B — about 1 min a take',
      'Careful · XL sft · 4B — about 7 min a take',
      'Short · Stable Audio Open 1.0 — about 40 s a take',
      'Shortest · Stable Audio Open Small — about 10 s a take',
      'Eleven Music · ElevenLabs, in the cloud — about 1 min a take',
    ])
    expect([...page.menu()!.querySelectorAll('optgroup')].map((g) => g.label)).toEqual([
      'ACE-Step · any length',
      'Stable Audio · short music only',
      'ElevenLabs · in the cloud, paid',
    ])
    expect(page.menu()!.parentElement!.textContent).toContain('Free')
  })

  it('says Eleven Music is made in the cloud and paid, and that it needs a key when there is none', () => {
    const page = render(answer({ model: 'eleven', installed, loops: [90] }))
    const text = page.container.textContent!
    expect(text).toContain(
      "Loops and stingers, made by ElevenLabs in the cloud. A track's takes can use another.",
    )
    expect(page.menu()!.parentElement!.querySelector('.free')!.textContent).toBe('Paid')
    expect(page.container.querySelector('.warnline')).toBeNull()
    const keyless = render(
      answer({ model: 'eleven', installed: { ...installed, eleven: false }, loops: [90] }),
    )
    expect(keyless.container.querySelector('.warnline')!.textContent).toBe(
      'needs an ElevenLabs key',
    )
  })

  it('is not shown, with the old introduction, in a project without music', () => {
    const page = render(answer(null))
    expect(page.menu()).toBeNull()
    expect(page.container.textContent).toContain('Which Fish model records each stage.')
  })

  it('saves a pick at once, with no question, and says Saving… while it does', async () => {
    let finish: (r: Response) => void = () => {}
    reply = () => new Promise((resolve) => (finish = resolve))
    const page = render(answer({ model: 'balanced', installed, loops: [90, 25] }))
    await page.pick('quick')
    expect(put).toEqual([{ model: 'quick', was: 'balanced' }])
    expect(page.menu()!.value).toBe('quick')
    expect(page.menu()!.disabled).toBe(true)
    expect(page.container.textContent).toContain('Saving…')
    await act(async () => finish(new Response(JSON.stringify({ ok: true }))))
    expect(page.container.textContent).not.toContain('Saving…')
  })

  it('says a save failed, goes back to the saved model, and offers Keep and Try again', async () => {
    reply = async () =>
      new Response(
        JSON.stringify({
          ok: false,
          problems: [{ file: 'a', path: 'music.model', message: 'disk full' }],
        }),
        { status: 409 },
      )
    const page = render(answer({ model: 'balanced', installed, loops: [90, 25] }))
    await page.pick('quick')
    const box = page.container.querySelector('[role="alert"]')!
    expect(box.textContent).toContain('Quick could not be saved as the music model.')
    expect(box.textContent).toContain(
      'audio-studio.json could not be saved: disk full. Nothing was changed.',
    )
    expect(page.menu()!.value).toBe('balanced')
    const buttons = [...box.querySelectorAll('button')].map((b) => b.textContent)
    expect(buttons).toEqual(['Keep Balanced', 'Try again'])
    expect(document.activeElement).toBe(box.querySelectorAll('button')[1] ?? null)
    await act(async () => box.querySelectorAll('button')[1]!.click())
    expect(put).toHaveLength(2)
  })

  it('marks a model this computer lacks, which can still be the project’s default', async () => {
    const page = render(
      answer({ model: 'careful', installed: { ...installed, careful: false }, loops: [] }),
    )
    const careful = [...page.menu()!.options].find((o) => o.value === 'careful')!
    expect(careful.textContent).toBe(
      'Careful · XL sft · 4B — about 7 min a take — not on this computer',
    )
    expect(careful.disabled).toBe(false)
    expect(page.container.querySelector('.warnline')!.textContent).toBe('not on this computer')
    await page.pick('quick')
    expect(put).toEqual([{ model: 'quick', was: 'careful' }])
  })

  it('says what a Stable Audio default means, and how many loops it leaves out', () => {
    const short = render(answer({ model: 'short', installed, loops: [90, 25, 130] }))
    expect(short.container.querySelector('.mshort')!.textContent).toBe(
      'Short makes stingers, and loops up to 27 s. 2 loops are longer: their takes will need another model, picked on their page.',
    )
    const shortest = render(answer({ model: 'shortest', installed, loops: [90] }))
    expect(shortest.container.querySelector('.mshort')!.textContent).toBe(
      'Shortest makes stingers, and no loops. 1 loop will need another model, picked on their page.',
    )
  })

  it('shows no such line for an ACE-Step model, and greys nothing for length', () => {
    const page = render(answer({ model: 'balanced', installed, loops: [90] }))
    expect(page.container.querySelector('.mshort')).toBeNull()
    expect([...page.menu()!.options].every((o) => !o.disabled)).toBe(true)
  })

  it('marks Stable Audio missing here, and it can still be the default', async () => {
    const page = render(
      answer({ model: 'balanced', installed: { ...installed, short: false }, loops: [] }),
    )
    const short = [...page.menu()!.options].find((o) => o.value === 'short')!
    expect(short.textContent).toBe(
      'Short · Stable Audio Open 1.0 — about 40 s a take — not on this computer',
    )
    expect(short.disabled).toBe(false)
    await page.pick('short')
    expect(put).toEqual([{ model: 'short', was: 'balanced' }])
  })
})
