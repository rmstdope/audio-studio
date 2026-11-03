import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { EffectRow, EffectsSummary } from '../../../core/effects'
import type { ProjectSummary } from '../../../core/summary'
import type { EffectsRoute } from '../../route'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { EffectsView } = await import('./EffectsView')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const realFetch = globalThis.fetch
const cleanups: (() => void)[] = []
afterEach(() => {
  globalThis.fetch = realFetch
  cleanups.splice(0).forEach((c) => c())
})
afterAll(() => GlobalRegistrator.unregister())

const row = (id: string, extra: Partial<EffectRow> = {}): EffectRow => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1).replaceAll('-', ' '),
  description: `${id} words`,
  gameDescription: `${id} words`,
  seconds: 3,
  changedHere: false,
  gameChanged: false,
  status: 'none-yet',
  current: { kind: 'nothing' },
  changed: [],
  chosen: false,
  ...extra,
})

const effects = (extra: Partial<EffectsSummary> = {}): EffectsSummary => {
  const rows = extra.rows ?? [row('door-creak'), row('coins', { seconds: 0.5 })]
  return {
    status: 'ok',
    canRefresh: true,
    rows,
    dropped: [],
    unreadable: 0,
    problems: [],
    done: { done: 0, total: rows.length, needs: rows.map((r) => r.id) },
    ...extra,
  }
}

type Call = { url: string; method: string; body: string | null }

/** Renders the view; every request is recorded and answered with `answer`. */
function render(
  route: EffectsRoute,
  data: EffectsSummary | null,
  answer: (call: Call) => Response | Promise<Response> = () => Response.json({ ok: true }),
  seed: [readonly unknown[], unknown][] = [],
) {
  const calls: Call[] = []
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const call = {
      url: String(url),
      method: init?.method ?? 'GET',
      body: (init?.body as string) ?? null,
    }
    calls.push(call)
    return Promise.resolve(answer(call))
  }) as typeof fetch
  const summary = { effects: data } as unknown as ProjectSummary
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  for (const [key, value] of seed) client.setQueryData(key, value)
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EffectsView, { summary, route }),
      ),
    ),
  )
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 5))))
  const text = () => container.textContent!.replace(/\s+/g, ' ')
  const button = (label: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent!.trim() === label)!
  return { container, calls, text, button, settle }
}

const list: EffectsRoute = { view: 'effects', page: null }
const page = (effect: string): EffectsRoute => ({ view: 'effects', page: 'effect', effect })

describe('the Sound effects list, with takes', () => {
  const chosen = (id: string, extra: Partial<EffectRow> = {}) =>
    row(id, {
      status: 'chosen',
      chosen: true,
      current: { kind: 'take', take: 2, exists: true },
      ...extra,
    })

  it('has a play button on a row whose chosen clip exists, and on no other', () => {
    const rows = [
      chosen('door-creak'),
      row('coins'),
      chosen('wind', {
        status: 'missing',
        current: { kind: 'take', take: 1, exists: false },
      }),
    ]
    const { container } = render(list, effects({ rows }))
    const buttons = (i: number) =>
      container.querySelectorAll('tbody tr')[i]!.querySelectorAll('.icon-btn')
    expect(buttons(0)).toHaveLength(1)
    expect(buttons(0)[0]!.getAttribute('aria-label')).toBe('Play Door creak: take 2')
    expect(buttons(1)).toHaveLength(0)
    expect(buttons(2)).toHaveLength(0)
  })

  it('plays the chosen take without opening the page, and stops on a second press', async () => {
    window.location.hash = '#/sound-effects'
    const { container, settle } = render(list, effects({ rows: [chosen('door-creak')] }))
    const play = container.querySelector<HTMLButtonElement>('tbody .icon-btn')!
    await act(async () => play.click())
    await settle()
    expect(window.location.hash).toBe('#/sound-effects')
    expect(play.getAttribute('aria-label')).toBe('Stop Door creak')
    await act(async () => play.click())
    expect(play.getAttribute('aria-label')).toBe('Play Door creak: take 2')
  })

  it('says each effect’s state in the Status column', () => {
    const rows = [
      row('a'),
      row('b', { status: 'not-chosen' }),
      chosen('c'),
      chosen('d', { status: 'changed', changed: ['description'] }),
      chosen('e', { status: 'missing', current: { kind: 'take', take: 1, exists: false } }),
      row('f', { status: 'unknown', current: { kind: 'unknown' } }),
    ]
    const { container } = render(list, effects({ rows }))
    const statuses = [...container.querySelectorAll('tbody tr')].map(
      (tr) => tr.querySelectorAll('td')[4]!.textContent,
    )
    expect(statuses).toEqual([
      'none yet',
      'not chosen',
      'chosen',
      'changed since chosen',
      'clip missing',
      'not known',
    ])
  })

  it('shows a batch being made in place of the status', () => {
    const { container } = render(
      list,
      effects({ rows: [row('coins', { status: 'not-chosen' })] }),
      undefined,
      [[['effects-making'], { coins: { takes: 4, left: 10 } }]],
    )
    expect(container.querySelector('tbody tr')!.querySelectorAll('td')[4]!.textContent).toBe(
      'making 4 takes · about 10 s',
    )
  })

  it('counts up to date effects in the ring and the subtitle counts out-of-date ones as chosen', () => {
    const rows = [chosen('a'), chosen('b', { status: 'changed', changed: ['length'] }), row('c')]
    const { text } = render(list, effects({ rows, done: { done: 1, total: 3, needs: ['b', 'c'] } }))
    expect(text()).toContain('2 of 3 chosen.')
    expect(text()).toContain('1 / 3')
  })
})

describe('the Sound effects list', () => {
  it('shows the title, the subtitle, the ring and the columns', () => {
    const { text, container } = render(list, effects())
    expect(container.querySelector('h1')!.textContent).toBe('Sound effects')
    expect(text()).toContain('The sound effects the game asks for. 0 of 2 chosen.')
    expect(text()).toContain('Effects up to date')
    expect(text()).toContain('0 / 2')
    expect(text()).toContain('2 need attention ›')
    expect([...container.querySelectorAll('th')].map((h) => h.textContent)).toEqual([
      '',
      'Effect',
      'Description',
      'Length',
      'Status',
    ])
  })

  it('shows a readable name with the id beneath, the length and none yet', () => {
    const { container } = render(list, effects())
    const first = container.querySelector('tbody tr')!
    expect(first.querySelector('strong')!.textContent).toBe('Door creak')
    expect(first.querySelector('.mono')!.textContent).toBe('door-creak')
    const cells = [...first.querySelectorAll('td')].map((c) => c.textContent)
    expect(cells[3]).toBe('3 s')
    expect(cells[4]).toBe('none yet')
    expect(container.querySelectorAll('tbody tr')[1]!.querySelectorAll('td')[3]!.textContent).toBe(
      '0.5 s',
    )
  })

  it('tags the words changed here, and the game’s change after it', () => {
    const rows = [
      row('door-creak', { changedHere: true, description: 'Mine' }),
      row('coins', { changedHere: true, gameChanged: true }),
    ]
    const { container } = render(list, effects({ rows }))
    const tags = (i: number) =>
      [...container.querySelectorAll('tbody tr')[i]!.querySelectorAll('.chip-warn')].map(
        (t) => t.textContent,
      )
    expect(tags(0)).toEqual(['changed here'])
    expect(tags(1)).toEqual(['changed here', "game's changed"])
    expect(container.querySelectorAll('tbody tr')[0]!.textContent).toContain('Mine')
  })

  it('opens a row’s page on a click and on Enter', () => {
    const { container } = render(list, effects())
    const rows = container.querySelectorAll<HTMLElement>('tbody tr')
    expect(rows[0]!.tabIndex).toBe(0)
    act(() => rows[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(window.location.hash).toBe('#/effects/items/door-creak')
    act(() => {
      rows[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(window.location.hash).toBe('#/effects/items/coins')
  })

  it('shows only what needs attention on request', () => {
    const data = effects()
    data.done.needs = ['coins']
    const { container, text } = render({ ...list, show: 'attention' }, data)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(text()).toContain('Show all')
  })

  it('leaves the button out without a refresh command', () => {
    const { container } = render(list, effects({ canRefresh: false }))
    expect(container.textContent).not.toContain('Refresh from the game')
  })

  it('lists the problems above the table and keeps the readable effects', () => {
    const problems = [{ file: 'tts/effects.json', path: '[2].id', message: '"x" is used twice' }]
    const { text, container } = render(list, effects({ problems, unreadable: 3 }))
    expect(text()).toContain('Some sound effects could not be read')
    expect(text()).toContain('tts/effects.json at [2].id: "x" is used twice')
    expect(text()).toContain('0 of 2 chosen; 3 could not be read.')
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
  })

  it('shows one line and no ring or table when the list cannot be read, is missing, or is empty', () => {
    const cases: [Partial<EffectsSummary>, string][] = [
      [
        { status: 'invalid', rows: [], problems: [{ file: 'f', path: '', message: 'bad' }] },
        'The list of sound effects could not be read; the problems above say why.',
      ],
      [
        { status: 'missing', rows: [] },
        'The game has not listed its sound effects yet. Refresh from the game.',
      ],
      [{ rows: [] }, 'The game asks for no sound effects.'],
    ]
    for (const [extra, line] of cases) {
      const { text, container } = render(list, effects(extra))
      expect(text()).toContain(line)
      expect(container.querySelector('table')).toBeNull()
      expect(text()).not.toContain('Effects up to date')
      cleanups.splice(0).forEach((c) => c())
    }
  })

  it('says how to set up when the project has no section, with an example', () => {
    const { text, button, container } = render(list, null)
    expect(text()).toContain('This project has no sound effects yet')
    expect(container.querySelector('pre')).toBeNull()
    act(() => button('How to set it up').click())
    expect(container.querySelector('pre')!.textContent).toContain('"effects"')
  })
})

describe('Refresh from the game', () => {
  it('runs, then summarises what was added and removed, until Close', async () => {
    const reply = {
      ok: true,
      effects: 8,
      change: { added: ['coins'], removed: ['lantern-hum'] },
      output: '',
    }
    const { button, text, settle, calls } = render(list, effects(), () => Response.json(reply))
    act(() => button('Refresh from the game').click())
    await settle()
    expect(calls[0]).toMatchObject({ url: '/api/effects/refresh', method: 'POST' })
    expect(text()).toContain('Sound effects refreshed')
    expect(text()).toContain('8 sound effects · 1 added · 1 removed')
    expect(text()).toContain('Added: coins')
    expect(text()).toContain('Removed: lantern-hum')
    act(() => button('Close').click())
    await settle()
    expect(text()).not.toContain('Sound effects refreshed')
  })

  it('disables the button while it runs', async () => {
    let finish: (r: Response) => void = () => {}
    const { button, settle } = render(
      list,
      effects(),
      () => new Promise<Response>((r) => (finish = r)),
    )
    act(() => button('Refresh from the game').click())
    await settle()
    expect(button('Refreshing from the game…').disabled).toBe(true)
    finish(Response.json({ ok: true, effects: 2, change: null, output: '' }))
    await settle()
  })

  it('shows the message and the command’s output when it fails', async () => {
    const reply = {
      ok: false,
      reason: 'failed',
      message: 'The command failed (exit code 1).',
      output: 'boom',
    }
    const { button, text, settle } = render(list, effects(), () =>
      Response.json(reply, { status: 409 }),
    )
    act(() => button('Refresh from the game').click())
    await settle()
    expect(text()).toContain('Refresh from the game failed')
    expect(text()).toContain('The command failed (exit code 1).')
    expect(text()).toContain('boom')
  })
})

describe('the dropped effects', () => {
  const dropped = [{ id: 'lantern-hum', name: 'Lantern hum', words: 'A soft hum' }]

  it('lists them with the words kept, below the table', () => {
    const { text } = render(list, effects({ dropped }))
    expect(text()).toContain("No longer in the game's list")
    expect(text()).toContain('Lantern hum')
    expect(text()).toContain('lantern-hum')
    expect(text()).toContain('A soft hum')
  })

  it('asks first; Cancel puts focus back on Forget', async () => {
    const { button, text, settle, calls } = render(list, effects({ dropped }))
    const forget = button('Forget')
    act(() => forget.click())
    expect(text()).toContain('Forget your description of lantern-hum?')
    expect(text()).toContain('Your words are deleted.')
    act(() => button('Cancel').click())
    await settle()
    expect(text()).not.toContain('Forget your description of')
    expect(document.activeElement).toBe(forget)
    expect(calls).toHaveLength(0)
  })

  it('treats Escape as Cancel', async () => {
    const { button, container, text, settle } = render(list, effects({ dropped }))
    act(() => button('Forget').click())
    const dialog = container.querySelector('[role="alertdialog"]')!
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await settle()
    expect(text()).not.toContain('Forget your description of')
  })

  it('says so when the game turns out to list the effect again', async () => {
    const { button, container, text, settle } = render(
      list,
      effects({ dropped }),
      () => new Response('{}', { status: 404 }),
    )
    act(() => button('Forget').click())
    const confirm = container.querySelector('[role="alertdialog"]')!
    act(() =>
      [...confirm.querySelectorAll('button')].find((b) => b.textContent === 'Forget')!.click(),
    )
    await settle()
    expect(text()).toContain('The game no longer lists this sound effect')
  })

  it('forgets on the second Forget', async () => {
    const { button, container, calls, settle } = render(list, effects({ dropped }))
    act(() => button('Forget').click())
    const confirm = container.querySelector('[role="alertdialog"]')!
    act(() =>
      [...confirm.querySelectorAll('button')].find((b) => b.textContent === 'Forget')!.click(),
    )
    await settle()
    expect(calls[0]).toMatchObject({ url: '/api/effects/lantern-hum/forget', method: 'POST' })
  })
})

describe("an effect's page", () => {
  it('shows the name, the id, the description box, the length and the takes panel', () => {
    const { container, text } = render(page('door-creak'), effects())
    expect(container.querySelector('h1')!.textContent).toBe('Door creak')
    expect(text()).toContain('door-creak')
    expect(container.querySelector('.crumbs a')!.getAttribute('href')).toBe('#/effects')
    expect(text()).toContain('What it should sound like')
    expect(text()).toContain('from the game')
    expect(container.querySelector('textarea')!.value).toBe('door-creak words')
    expect(text()).toContain('3 s · set by the game')
    expect(text()).toContain('Loading takes…')
    expect(text()).not.toContain('Saved')
  })

  it('saves the words when the box is left, and says Saved', async () => {
    const { container, calls, text, settle } = render(page('door-creak'), effects())
    const box = container.querySelector('textarea')!
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      set.call(box, 'A heavy creak')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    await settle()
    expect(calls[0]).toMatchObject({ url: '/api/effects/door-creak', method: 'PATCH' })
    expect(JSON.parse(calls[0]!.body!)).toEqual({ description: 'A heavy creak' })
    expect(text()).toContain('Saved')
  })

  it('sends nothing when the box is left unchanged', async () => {
    const { container, calls, settle } = render(page('door-creak'), effects())
    const box = container.querySelector('textarea')!
    act(() => box.focus())
    act(() => box.blur())
    await settle()
    expect(calls).toHaveLength(0)
  })

  it('shows changed words with the game’s beneath, and use the game’s', async () => {
    const rows = [
      row('door-creak', { changedHere: true, description: 'Mine', gameDescription: 'Theirs' }),
    ]
    const { text, container, calls, settle } = render(page('door-creak'), effects({ rows }))
    expect(text()).toContain('changed here ·')
    expect(text()).toContain("The game's: Theirs")
    act(() => container.querySelector<HTMLButtonElement>('.link-button')!.click())
    await settle()
    expect(JSON.parse(calls[0]!.body!)).toEqual({ description: null })
  })

  it('keeps what was typed and says why when saving fails', async () => {
    const problems = [
      { file: '.content-studio/effects.json', path: '', message: 'permission denied' },
    ]
    const { container, text, settle } = render(page('door-creak'), effects(), () =>
      Response.json({ ok: false, problems }, { status: 409 }),
    )
    const box = container.querySelector('textarea')!
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      set.call(box, 'Typed')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    await settle()
    expect(text()).toContain('The description could not be saved')
    expect(text()).toContain('permission denied')
    expect(container.querySelector('textarea')!.value).toBe('Typed')
    expect(text()).not.toContain('Saved')
  })

  it('shows the notice when the game reworded it, with Use the game’s and Keep mine', async () => {
    const rows = [
      row('door-creak', {
        changedHere: true,
        gameChanged: true,
        description: 'Mine',
        gameDescription: 'Fresh words',
      }),
    ]
    const { text, button, calls, settle } = render(page('door-creak'), effects({ rows }))
    expect(text()).toContain("The game's description changed since you changed yours.")
    expect(text()).toContain("Yours is still the one used. The game's now says: Fresh words")
    act(() => button('Keep mine').click())
    await settle()
    expect(calls[0]).toMatchObject({ url: '/api/effects/door-creak/keep-mine', method: 'POST' })
    act(() => button("Use the game's").click())
    await settle()
    expect(JSON.parse(calls[1]!.body!)).toEqual({ description: null })
  })

  it('says why Keep mine did not work', async () => {
    const rows = [row('door-creak', { changedHere: true, gameChanged: true })]
    const problems = [{ file: '.content-studio/effects.json', path: '', message: 'disk is full' }]
    const { text, button, settle } = render(page('door-creak'), effects({ rows }), () =>
      Response.json({ ok: false, problems }, { status: 409 }),
    )
    act(() => button('Keep mine').click())
    await settle()
    expect(text()).toContain('disk is full')
    expect(button('Keep mine').disabled).toBe(false)
  })

  it('has no notice when the game did not reword it', () => {
    const { text } = render(page('door-creak'), effects())
    expect(text()).not.toContain('description changed since')
  })

  it('says the game no longer lists an effect an old link names, with a way back', () => {
    const { text, container } = render(page('gone'), effects())
    expect(text()).toContain('The game no longer lists this sound effect.')
    const back = [...container.querySelectorAll('a')].find(
      (a) => a.textContent === 'Back to Sound effects',
    )!
    expect(back.getAttribute('href')).toBe('#/effects')
  })
})
