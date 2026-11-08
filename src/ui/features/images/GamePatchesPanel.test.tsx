import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ImageRow, PatchRow } from '../../../core/images'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { GamePatchesPanel } = await import('./GamePatchesPanel')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
const realFetch = globalThis.fetch
afterEach(() => {
  cleanups.splice(0).forEach((c) => c())
  globalThis.fetch = realFetch
})
afterAll(() => GlobalRegistrator.unregister())

const patch = (id: string, over: Partial<PatchRow> = {}): PatchRow => ({
  id,
  title: `Title of ${id}`,
  description: `Game words of ${id}`,
  words: `Game words of ${id}`,
  changed: false,
  gameChanged: false,
  gameWas: null,
  ...over,
})

/** Renders the panel for an image with these patches; `answer` is what saving answers. */
async function render(
  patches: PatchRow[],
  answer: { status: number; body: unknown } = { status: 200, body: { ok: true } },
) {
  const sent: { method: string; path: string; body: unknown }[] = []
  globalThis.fetch = (async (path: string, init?: RequestInit) => {
    sent.push({
      method: init?.method ?? 'GET',
      path,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
    return Response.json(answer.body, { status: answer.status })
  }) as unknown as typeof fetch
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(GamePatchesPanel, { row: { id: 'inn', patches } as ImageRow }),
      ),
    )
  })
  cleanups.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  return { host, sent }
}

const rowButtons = (host: Element) => [
  ...host.querySelectorAll<HTMLButtonElement>('button.game-patch-row'),
]
const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

/** Types into a textarea and leaves it. */
async function reword(field: HTMLTextAreaElement, words: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  await act(async () => {
    set.call(field, words)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    field.dispatchEvent(new Event('blur'))
  })
  for (let i = 0; i < 3; i++) await act(async () => await new Promise((r) => setTimeout(r, 5)))
}

describe('GamePatchesPanel', () => {
  it('is not on the page for an image with no patches', async () => {
    const { host } = await render([])
    expect(host.innerHTML).toBe('')
  })

  it('lists the patches by title with their id, all closed, each row a button that says so', async () => {
    const { host } = await render([patch('bread-taken'), patch('door-ajar')])
    expect(text(host.querySelector('h2'))).toBe('Patches the game asks for')
    expect(text(host.querySelector('.game-patches-intro'))).toBe(
      'Small changes the game lays over this image when it needs them.',
    )
    const rows = rowButtons(host)
    expect(rows.map((r) => text(r))).toEqual([
      '▸Title of bread-takenbread-taken',
      '▸Title of door-ajardoor-ajar',
    ])
    expect(rows.map((r) => r.getAttribute('aria-expanded'))).toEqual(['false', 'false'])
    expect(host.querySelector('textarea')).toBeNull()
  })

  it('opens a patch in place with one field of words and closes it again; several can be open', async () => {
    const { host } = await render([patch('bread-taken'), patch('door-ajar')])
    const [first, second] = rowButtons(host)
    await act(async () => first!.click())
    await act(async () => second!.click())
    expect(rowButtons(host).map((r) => r.getAttribute('aria-expanded'))).toEqual(['true', 'true'])
    const fields = [...host.querySelectorAll('textarea')]
    expect(fields.map((f) => f.value)).toEqual([
      'Game words of bread-taken',
      'Game words of door-ajar',
    ])
    expect(text(host.querySelector('label'))).toBe('What should change')
    expect(text(host.querySelector('.field-tag'))).toBe('from the game')
    await act(async () => first!.click())
    expect(host.querySelectorAll('textarea').length).toBe(1)
    expect(rowButtons(host)[0]!.getAttribute('aria-expanded')).toBe('false')
  })

  it('saves rewording when the field is left, shows Saved, and the game’s words', async () => {
    const { host, sent } = await render([patch('bread-taken')])
    await act(async () => rowButtons(host)[0]!.click())
    await reword(host.querySelector('textarea')!, 'No bread at all')
    expect(sent).toEqual([
      {
        method: 'PATCH',
        path: '/api/images/inn/game-patches/bread-taken',
        body: { words: 'No bread at all' },
      },
    ])
    expect(text(host.querySelector('.saved'))).toBe('Saved')
  })

  it('marks a reworded patch on its closed row, and offers the game’s words back when open', async () => {
    const { host, sent } = await render([
      patch('bread-taken', { changed: true, words: 'Mine', gameWas: 'Game words of bread-taken' }),
    ])
    expect(text(rowButtons(host)[0]!.querySelector('.game-patch-mark'))).toBe('changed here')
    await act(async () => rowButtons(host)[0]!.click())
    expect(text(host.querySelector('.field-tag'))).toBe("changed here · use the game's")
    expect(text(host.querySelector('.game-patch-body .muted'))).toBe(
      "The game's words: Game words of bread-taken",
    )
    await act(async () => host.querySelector<HTMLButtonElement>('.field-tag button')!.click())
    expect(sent[0]).toMatchObject({ body: { words: null } })
  })

  it('opens by itself a patch whose game words changed under the user’s, with the notice and both buttons', async () => {
    const { host, sent } = await render([
      patch('bread-taken'),
      patch('door-ajar', {
        changed: true,
        gameChanged: true,
        words: 'My door',
        description: 'New door words',
        gameWas: 'Old door words',
      }),
    ])
    expect(rowButtons(host).map((r) => r.getAttribute('aria-expanded'))).toEqual(['false', 'true'])
    expect(text(rowButtons(host)[1]!.querySelector('.game-patch-mark'))).toBe(
      'the game changed its words',
    )
    const notice = host.querySelector('.notice')!
    expect(text(notice.querySelector('strong'))).toBe(
      "The game changed this patch's words since you wrote your own.",
    )
    expect(text(notice)).toContain('Your words (used now)My door')
    expect(text(notice)).toContain("The game's new wordsNew door wordsBefore: Old door words")
    expect([...notice.querySelectorAll('button')].map((b) => text(b))).toEqual([
      "Use the game's",
      'Keep mine',
    ])
    expect(notice.querySelector('.btn-primary')?.textContent).toBe('Keep mine')
    await act(async () => notice.querySelectorAll('button')[1]!.click())
    expect(sent[0]).toEqual({
      method: 'POST',
      path: '/api/images/inn/game-patches/door-ajar/compare',
      body: { choice: 'keep' },
    })
  })

  it('settles with either button, keeps the patch open and moves focus to its field', async () => {
    const changed = patch('door-ajar', {
      changed: true,
      gameChanged: true,
      words: 'My door',
      gameWas: 'Old',
    })
    const { host, sent } = await render([changed])
    await act(async () => host.querySelector<HTMLButtonElement>('.btn:not(.btn-primary)')!.click())
    for (let i = 0; i < 3; i++) await act(async () => await new Promise((r) => setTimeout(r, 5)))
    expect(sent[0]).toEqual({
      method: 'POST',
      path: '/api/images/inn/game-patches/door-ajar/compare',
      body: { choice: 'game' },
    })
    expect(rowButtons(host)[0]!.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(host.querySelector('textarea'))
  })

  it('reports a compare that could not be saved', async () => {
    const { host } = await render(
      [patch('door-ajar', { changed: true, gameChanged: true, words: 'Mine', gameWas: 'Old' })],
      {
        status: 409,
        body: { ok: false, problems: [{ file: 'edits.json', path: '', message: 'nope' }] },
      },
    )
    await act(async () => host.querySelector<HTMLButtonElement>('.btn-primary')!.click())
    for (let i = 0; i < 3; i++) await act(async () => await new Promise((r) => setTimeout(r, 5)))
    expect(text(host.querySelector('.notice'))).toContain('nope')
  })

  it('reports a failed save under that patch’s field', async () => {
    const { host } = await render([patch('bread-taken')], {
      status: 409,
      body: {
        ok: false,
        problems: [
          { file: 'content-studio/images/edits.json', path: '', message: 'cannot be written' },
        ],
      },
    })
    await act(async () => rowButtons(host)[0]!.click())
    await reword(host.querySelector('textarea')!, 'x')
    expect(text(host.querySelector('.game-patch-body'))).toContain('cannot be written')
    expect(host.querySelector('.saved')).toBeNull()
  })
})
