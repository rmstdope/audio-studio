import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { PlayingPanel } = await import('./PlayingPanel')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

/** Renders the panel over a fake server holding the saved fade; `failWith` makes saves fail. */
async function setUp(saved: number, options: { failWith?: string; unreadable?: boolean } = {}) {
  const realFetch = globalThis.fetch
  const server = { saved, saves: [] as number[], fail: options.failWith }
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url === '/api/take-fade') {
      const { seconds } = JSON.parse(String(init?.body)) as { seconds: number }
      server.saves.push(seconds)
      if (server.fail) {
        return Response.json(
          {
            ok: false,
            problems: [{ file: 'audio-studio.json', path: 'takeFade', message: server.fail }],
          },
          { status: 409 },
        )
      }
      server.saved = seconds
      return Response.json({ ok: true })
    }
    if (options.unreadable)
      return Response.json({ ok: false, file: 'audio-studio.json', problems: [] })
    return Response.json({
      ok: true,
      summary: { takeFade: server.saved, projectFile: 'audio-studio.json' },
    })
  }) as unknown as typeof fetch
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(PlayingPanel),
      ),
    ),
  )
  const settle = async () => {
    for (let i = 0; i < 10; i++) await act(() => new Promise((r) => setTimeout(r, 10)))
  }
  await settle()
  const menu = () => container.querySelector('select')
  const pick = async (value: string) => {
    const select = menu()!
    select.focus()
    await act(async () => {
      select.value = value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    // The query client tells its observers on the next tick.
    await act(() => new Promise((r) => setTimeout(r, 0)))
  }
  const done = () => {
    act(() => root.unmount())
    globalThis.fetch = realFetch
  }
  return { container, server, menu, pick, settle, done }
}

describe('the Playing takes panel', () => {
  it('has its heading, words and a menu showing 0.2 s when nothing is saved', async () => {
    const { container, menu, done } = await setUp(0.2)
    try {
      expect(container.querySelector('h2')?.textContent).toBe('Playing takes')
      expect(container.textContent).toContain(
        'How music takes sound when you play them in the studio. Saved in audio-studio.json for everyone on the project.',
      )
      expect(container.querySelector('.mname')?.textContent).toBe('Fade in and out')
      expect(container.textContent).toContain(
        "Every take fades in at its start and out at its end or when you stop it. The game's own file always plays as it is.",
      )
      expect([...menu()!.options].map((o) => o.textContent)).toEqual([
        'No fade',
        '0.1 s',
        '0.2 s',
        '0.5 s',
        '1 s',
        '2 s',
      ])
      expect(menu()!.value).toBe('0.2')
    } finally {
      done()
    }
  })

  it('is not shown while the project file cannot be read', async () => {
    const { container, done } = await setUp(0.2, { unreadable: true })
    try {
      expect(container.innerHTML).toBe('')
    } finally {
      done()
    }
  })

  it('saves a pick at once, shows it, and keeps focus on the menu', async () => {
    const { menu, server, pick, settle, done } = await setUp(0.2)
    try {
      await pick('1')
      expect(menu()!.value).toBe('1')
      await settle()
      expect(server.saves).toEqual([1])
      expect(menu()!.value).toBe('1')
      expect(document.activeElement).toBe(menu())
    } finally {
      done()
    }
  })

  it('saves No fade as 0', async () => {
    const { server, pick, done } = await setUp(0.2)
    try {
      await pick('0')
      expect(server.saves).toEqual([0])
    } finally {
      done()
    }
  })

  it('shows a length set by hand in its place, until another is picked', async () => {
    const { menu, pick, settle, done } = await setUp(0.3)
    try {
      expect([...menu()!.options].map((o) => o.textContent)).toEqual([
        'No fade',
        '0.1 s',
        '0.2 s',
        '0.3 s',
        '0.5 s',
        '1 s',
        '2 s',
      ])
      expect(menu()!.value).toBe('0.3')
      await pick('0.5')
      await settle()
      expect([...menu()!.options].map((o) => o.textContent)).not.toContain('0.3 s')
    } finally {
      done()
    }
  })

  it('goes back to the saved length when a save fails, says why, and keeps focus', async () => {
    const { container, menu, pick, settle, done } = await setUp(0.2, {
      failWith: 'the project file could not be written',
    })
    try {
      await pick('1')
      await settle()
      expect(menu()!.value).toBe('0.2')
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        'Could not save the fade: the project file could not be written. It is still 0.2 s.',
      )
      expect(document.activeElement).toBe(menu())
    } finally {
      done()
    }
  })

  it('keeps the failure line while the next save runs, if it fails too', async () => {
    const { container, pick, done } = await setUp(0.2, { failWith: 'no' })
    try {
      await pick('1')
      await pick('2')
      expect(container.querySelector('[role="alert"]')).not.toBeNull()
    } finally {
      done()
    }
  })

  it('drops the failure line when the next save succeeds', async () => {
    const { container, server, pick, settle, done } = await setUp(0.2, { failWith: 'no' })
    try {
      await pick('1')
      await settle()
      server.fail = undefined
      await pick('2')
      await settle()
      expect(container.querySelector('[role="alert"]')).toBeNull()
    } finally {
      done()
    }
  })
})
