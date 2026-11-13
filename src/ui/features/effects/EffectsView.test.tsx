import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { EffectRow, EffectsSummary } from '../../../core/effects'
import type { EffectTakesView } from '../../../core/effectTakes'
import type { ProjectSummary } from '../../../core/summary'
import type { EffectsRoute } from '../../route'
import { installFakeWebAudio, started } from '../../../../test/fakeWebAudio'
import { readFileSync } from 'node:fs'
import { ProjectSchema } from '../../../core/project'
import { projectJson } from '../../../../test/helpers'
import { minWidthsInEveryWindow } from '../../../../test/stylesheet'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { EffectsView } = await import('./EffectsView')
const { WhyTip } = await import('../../components/WhyTip')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Whether a control is greyed: `aria-disabled`, so it still takes focus and shows its reason. */
const isOff = (element: Element) => element.getAttribute('aria-disabled') === 'true'

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
  loops: false,
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
        createElement(
          'div',
          null,
          createElement(WhyTip),
          createElement(EffectsView, { summary, route }),
        ),
      ),
    ),
  )
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 5))))
  const text = () => container.textContent!.replace(/\s+/g, ' ')
  const button = (label: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent!.trim() === label)!
  return { container, calls, text, button, settle, client }
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

  it('tags a looping effect "loops" beside its length, and no other', () => {
    const { container } = render(
      list,
      effects({ rows: [row('door-creak'), row('wind', { loops: true, seconds: 10 })] }),
    )
    const lengths = [...container.querySelectorAll('tbody td.effects-length')]
    expect(lengths.map((td) => td.textContent)).toEqual(['3 s', '10 sloops'])
    expect(lengths[1]!.querySelector('.loops-tag')!.textContent).toBe('loops')
    expect(container.querySelectorAll('.loops-tag')).toHaveLength(1)
  })

  it('plays a looping row round until ■ is pressed, and a one-shot row once', async () => {
    cleanups.push(installFakeWebAudio())
    const { container, settle } = render(
      list,
      effects({
        rows: [chosen('wind', { loops: true, seconds: 10 }), chosen('door-creak')],
      }),
    )
    const [wind, door] = [...container.querySelectorAll<HTMLButtonElement>('tbody .icon-btn')]
    await act(async () => wind!.click())
    await settle()
    expect(started).toEqual([{ loop: true }])
    expect(wind!.getAttribute('aria-label')).toBe('Stop Wind')
    await act(async () => wind!.click())
    expect(wind!.getAttribute('aria-label')).toBe('Play Wind: take 2')
    await act(async () => door!.click())
    await settle()
    expect(started).toEqual([{ loop: true }])
  })

  it('says on the effect’s page that it loops', () => {
    const { text } = render(
      page('wind'),
      effects({ rows: [row('wind', { loops: true, seconds: 10 }), row('coins')] }),
    )
    expect(text()).toContain('10 s · loops · set by the game')
    cleanups.splice(0).forEach((c) => c())
    const once = render(page('coins'), effects({ rows: [row('coins')] }))
    expect(once.text()).toContain('3 s · set by the game')
    expect(once.text()).not.toContain('loops')
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

  it('shows an effects section the studio accepts', () => {
    const { button, container } = render(list, null)
    act(() => button('How to set it up').click())
    const example = JSON.parse(`{${container.querySelector('pre')!.textContent}}`)
    const parsed = ProjectSchema.safeParse({ ...projectJson(), ...example })
    expect(parsed.error?.issues ?? []).toEqual([])
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
    expect(isOff(button('Refreshing from the game…'))).toBe(true)
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

  it('stack in a narrow window, as the effects rows do, so Forget is never off the edge', () => {
    const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')
    const at = css.indexOf('@container panel (max-width: 700px) {\n  .stack-table')
    const narrow = at < 0 ? '' : css.slice(at, css.indexOf('\n}\n', at))
    const { container } = render(list, effects({ dropped }))
    const panel = container.querySelector('[aria-label="No longer in the game\'s list"]')!
    const table = panel.querySelector('table')!
    const stacking = [...table.classList].filter((c) =>
      new RegExp(`\\.${c}\\b[^{}]*\\{[^}]*display:\\s*block[^}]*min-width:\\s*0`).test(narrow),
    )
    expect(stacking).not.toEqual([])
  })

  it('fit the panel in a window wider than the stacking width, so Forget is never off the edge', () => {
    const { container } = render(list, effects({ dropped }))
    const panel = container.querySelector('[aria-label="No longer in the game\'s list"]')!
    const table = panel.querySelector('table')!
    expect(table.closest('.table-box')).toBeNull()
    expect(minWidthsInEveryWindow(table)).toEqual([])
    // The effects table above stacks too, so its box holds no minimum either (as-35pz).
    const boxed = container.querySelector('.table-box table')!
    expect(minWidthsInEveryWindow(boxed)).toEqual([])
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

  it('has the previous/next control, in the list’s order, with an end greyed out', () => {
    const { container } = render(page('door-creak'), effects())
    const pager = container.querySelector('.pager')!
    expect(pager.textContent).toBe('‹1 of 2›')
    const [prev, next] = [...pager.querySelectorAll('button')]
    expect(prev!.getAttribute('aria-disabled')).toBe('true')
    expect(next!.title).toBe('Next: Coins (→)')
    window.location.hash = '#/start'
    act(() => next!.click())
    expect(window.location.hash).toBe('#/effects/items/coins')
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

  describe('Make pressed straight after typing the words', () => {
    const noTakes: EffectTakesView = {
      ok: true,
      canMake: true,
      projectModel: 'small-sfx',
      uv: true,
      models: [
        { id: 'small-sfx', download: 'whole', failed: false },
        { id: 'open-1', download: 'whole', failed: false },
      ],
      takes: [],
      making: [],
      failed: [],
      lockUnread: false,
    }
    const oneFailed = { failed: [{ n: 1, message: 'It broke.' }] }

    /** The page with new words typed and `press` pressed at once, whose save waits for `release`. */
    async function typedAndPressed(
      answer: () => Response,
      press = 'Make 4 takes',
      takes: Partial<EffectTakesView> = {},
    ) {
      let release = () => {}
      const held = new Promise<void>((resolve) => (release = resolve))
      const shown = render(
        page('door-creak'),
        effects(),
        async (call) => {
          if (call.method !== 'PATCH') return Response.json({ ok: true })
          await held
          return answer()
        },
        [[['effect-takes', 'door-creak'], { ...noTakes, ...takes }]],
      )
      const box = shown.container.querySelector('textarea')!
      act(() => {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
        set.call(box, 'A heavy creak')
        box.dispatchEvent(new Event('input', { bubbles: true }))
      })
      // The press of the mouse leaves the field; the click comes before anything has rendered.
      await act(async () => {
        box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
        shown.button(press).click()
      })
      await shown.settle()
      const asked = () => shown.calls.filter((c) => c.method !== 'GET').map((c) => c.method)
      const takesAsked = () =>
        shown.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/door-creak/takes'))
      const finish = async () => {
        await act(async () => release())
        await shown.settle()
      }
      return { ...shown, asked, takesAsked, finish }
    }

    it('asks for the takes only once the words are saved', async () => {
      const { asked, takesAsked, finish } = await typedAndPressed(() => Response.json({ ok: true }))
      expect(asked()).toEqual(['PATCH'])
      await finish()
      expect(asked()).toEqual(['PATCH', 'POST'])
      expect(JSON.parse(takesAsked()[0]!.body!)).toEqual({ count: 4, model: 'small-sfx' })
    })

    it('keeps Make off while it waits, so a second press asks for nothing more', async () => {
      const { button, takesAsked, finish } = await typedAndPressed(() =>
        Response.json({ ok: true }),
      )
      expect(isOff(button('Make 4 takes'))).toBe(true)
      await act(async () => button('Make 4 takes').click())
      await finish()
      expect(takesAsked()).toHaveLength(1)
    })

    it('keeps the menus still while it waits, so the press makes what it showed', async () => {
      const { container, finish } = await typedAndPressed(() => Response.json({ ok: true }))
      const menus = [...container.querySelectorAll('select')]
      expect(menus.map(isOff)).toEqual([true, true])
      await finish()
    })

    it('makes nothing when the words could not be saved, and says why', async () => {
      const { button, text, takesAsked, finish } = await typedAndPressed(() =>
        Response.json({
          ok: false,
          problems: [{ file: 'edits.json', path: 'description', message: 'Too long' }],
        }),
      )
      await finish()
      expect(takesAsked()).toEqual([])
      expect(text()).toContain('Too long')
      expect(isOff(button('Make 4 takes'))).toBe(false)
    })

    it('makes nothing when the save itself failed', async () => {
      const { button, takesAsked, finish } = await typedAndPressed(
        () => new Response('', { status: 500 }),
      )
      await finish()
      expect(takesAsked()).toEqual([])
      expect(isOff(button('Make 4 takes'))).toBe(false)
    })

    it('saves the words again on another press after a failed save, then asks for the takes', async () => {
      let answers = 0
      const { button, asked, takesAsked, finish, settle } = await typedAndPressed(() =>
        answers++ === 0 ? new Response('', { status: 500 }) : Response.json({ ok: true }),
      )
      await finish()
      expect(takesAsked()).toEqual([])
      await act(async () => button('Make 4 takes').click())
      await settle()
      expect(asked()).toEqual(['PATCH', 'PATCH', 'POST'])
    })

    it('waits the same way for Try again on a failed take', async () => {
      const { asked, takesAsked, finish } = await typedAndPressed(
        () => Response.json({ ok: true }),
        'Try again',
        oneFailed,
      )
      expect(asked()).toEqual(['PATCH'])
      await finish()
      expect(JSON.parse(takesAsked()[0]!.body!)).toEqual({ retry: 1 })
    })

    it('makes nothing on Try again when the words could not be saved', async () => {
      const { takesAsked, finish } = await typedAndPressed(
        () => new Response('', { status: 500 }),
        'Try again',
        oneFailed,
      )
      await finish()
      expect(takesAsked()).toEqual([])
    })

    it('keeps Try again off while a press of Make waits for the words', async () => {
      const { button, finish } = await typedAndPressed(
        () => Response.json({ ok: true }),
        'Make 4 takes',
        oneFailed,
      )
      expect(isOff(button('Try again'))).toBe(true)
      await finish()
    })

    it('asks for the takes at once when nothing was typed', async () => {
      const { calls, button, settle } = render(page('door-creak'), effects(), undefined, [
        [['effect-takes', 'door-creak'], noTakes],
      ])
      await act(async () => button('Make 4 takes').click())
      await settle()
      expect(calls.filter((c) => c.method !== 'GET').map((c) => c.method)).toEqual(['POST'])
    })
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
      { file: 'content-studio/effects/edits.json', path: '', message: 'permission denied' },
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
    const problems = [
      { file: 'content-studio/effects/edits.json', path: '', message: 'disk is full' },
    ]
    const { text, button, settle } = render(page('door-creak'), effects({ rows }), () =>
      Response.json({ ok: false, problems }, { status: 409 }),
    )
    act(() => button('Keep mine').click())
    await settle()
    expect(text()).toContain('disk is full')
    expect(isOff(button('Keep mine'))).toBe(false)
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

describe('Make all, on the Sound effects list', () => {
  const chosen = (id: string, extra: Partial<EffectRow> = {}) =>
    row(id, {
      status: 'chosen',
      chosen: true,
      current: { kind: 'take', take: 2, exists: true },
      ...extra,
    })
  const models = (over: { small?: string; open?: string; can?: boolean } = {}) => ({
    ok: true,
    canMake: over.can ?? true,
    projectModel: 'small-sfx',
    uv: true,
    models: [
      { id: 'small-sfx', download: over.small ?? 'whole', failed: false },
      { id: 'open-1', download: over.open ?? 'whole', failed: false },
    ],
  })
  const seeds = (extra: [readonly unknown[], unknown][] = []): [readonly unknown[], unknown][] => [
    [['effect-models'], models()],
    [['effects-making'], {}],
    [['effects-batch'], null],
    ...extra,
  ]
  const four = [row('door-creak'), row('coins'), row('thunder'), row('wind')]
  const posts = (calls: Call[]) => calls.filter((c) => c.method === 'POST')

  it('counts the effects with no chosen take, with or without takes, whatever the list is filtered to', () => {
    const rows = [
      row('a'),
      row('b', { status: 'not-chosen' }),
      chosen('c'),
      chosen('d', { status: 'changed' }),
      chosen('e', { status: 'missing', current: { kind: 'take', take: 1, exists: false } }),
    ]
    const data = effects({ rows, done: { done: 3, total: 5, needs: ['a', 'b', 'd', 'e'] } })
    const all = render(list, data, undefined, seeds())
    expect(all.text()).toContain('2 effects have no chosen take')
    expect(all.button('Make 4 takes each')).toBeDefined()
    const filtered = render({ ...list, show: 'attention' }, data, undefined, seeds())
    expect(filtered.text()).toContain('2 effects have no chosen take')
  })

  it('says "1 effect has no chosen take" for one', () => {
    const { text } = render(list, effects({ rows: [row('a'), chosen('b')] }), undefined, seeds())
    expect(text()).toContain('1 effect has no chosen take')
  })

  it('opens a question under the button, starts nothing, and puts focus on Make', async () => {
    const { container, calls, text, button } = render(
      list,
      effects({ rows: four }),
      undefined,
      seeds(),
    )
    act(() => button('Make 4 takes each').click())
    expect(text()).toContain('Make 16 takes for 4 effects?')
    expect(text()).toContain(
      'Four takes each, on Stable Audio 3 Small SFX, the sound-effects model on Setup. About 1 min in all — they are made one after another, and you can leave the page.',
    )
    const names = [...container.querySelectorAll('.effects-make-all-question li')].map(
      (li) => li.textContent,
    )
    expect(names).toEqual(['Door creak', 'Coins', 'Thunder', 'Wind'])
    expect(document.activeElement).toBe(button('Make 16 takes'))
    expect(posts(calls)).toEqual([])
    // The list is still there under the question.
    expect(container.querySelectorAll('tbody tr')).toHaveLength(4)
  })

  it('names the left-out effects in the question', () => {
    const rows = [row('a'), chosen('door-creak'), chosen('footsteps')]
    const { text, button } = render(list, effects({ rows }), undefined, seeds())
    act(() => button('Make 4 takes each').click())
    expect(text()).toContain('Door creak and Footsteps have a chosen take and get none.')
    expect(text()).not.toContain('already making')
  })

  it('Cancel and Escape close it, write nothing and put focus back on the button', () => {
    const { container, calls, text, button } = render(
      list,
      effects({ rows: four }),
      undefined,
      seeds(),
    )
    act(() => button('Make 4 takes each').click())
    act(() => button('Cancel').click())
    expect(text()).not.toContain('Make 16 takes for 4 effects?')
    expect(document.activeElement).toBe(button('Make 4 takes each'))
    act(() => button('Make 4 takes each').click())
    act(() => {
      container
        .querySelector('.effects-make-all-question')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(text()).not.toContain('Make 16 takes for 4 effects?')
    expect(document.activeElement).toBe(button('Make 4 takes each'))
    expect(posts(calls)).toEqual([])
  })

  it('Make asks for the listed effects only', async () => {
    const { calls, button, settle } = render(
      list,
      effects({ rows: [...four, chosen('rain')] }),
      () => Response.json({ ok: true, started: [] }),
      seeds(),
    )
    act(() => button('Make 4 takes each').click())
    act(() => button('Make 16 takes').click())
    await settle()
    const post = posts(calls).find((c) => c.url === '/api/effects/make-all')!
    expect(JSON.parse(post.body!)).toEqual({ ids: ['door-creak', 'coins', 'thunder', 'wind'] })
  })

  it('says the takes could not be started, closes the question, and keeps the button', async () => {
    const { text, button, settle } = render(
      list,
      effects({ rows: four }),
      (call) =>
        call.method === 'POST'
          ? Response.json({ ok: false, message: 'x' }, { status: 409 })
          : Response.json(null),
      seeds(),
    )
    act(() => button('Make 4 takes each').click())
    act(() => button('Make 16 takes').click())
    await settle()
    expect(text()).toContain('The takes could not be started. Nothing was made; try again.')
    expect(text()).not.toContain('Make 16 takes for 4 effects?')
    expect(button('Make 4 takes each')).toBeDefined()
  })

  it('uses the other model, and says so, when Setup’s is not on this computer', () => {
    const { text, button } = render(
      list,
      effects({ rows: four }),
      undefined,
      seeds([[['effect-models'], models({ small: 'absent' })]]),
    )
    act(() => button('Make 4 takes each').click())
    expect(text()).toContain(
      "Four takes each, on Stable Audio Open 1.0. Stable Audio 3 Small SFX, the project's sound-effects model, isn't on this computer, so these takes use Stable Audio Open 1.0. Setup says how to download it. About 27 min in all — they are made one after another, and you can leave the page.",
    )
  })

  it('offers only Open Setup when neither model can run', () => {
    const { container, text } = render(
      list,
      effects({ rows: four }),
      undefined,
      seeds([[['effect-models'], models({ small: 'absent', open: 'absent', can: false })]]),
    )
    expect(text()).toContain("Sound effects can't be made yet. Setup says what is missing.")
    expect(text()).not.toContain('Make 4 takes each')
    expect(container.querySelector('a[href="#/setup"]')!.textContent).toBe('Open Setup')
  })

  it('says every effect has a chosen take, with no button', () => {
    const { text } = render(list, effects({ rows: [chosen('a'), chosen('b')] }), undefined, seeds())
    expect(text()).toContain('Every effect has a chosen take.')
    expect(text()).not.toContain('Make 4 takes each')
  })

  it('shows nothing when which effects are chosen is not known', () => {
    const rows = [row('a', { status: 'unknown', current: { kind: 'unknown' } })]
    const { text } = render(list, effects({ rows }), undefined, seeds())
    expect(text()).not.toContain('chosen take')
    expect(text()).not.toContain('Make 4 takes each')
  })

  it('shows what is running instead of the button, with Stop all, hand-started takes counted', async () => {
    const making = { coins: { takes: 8, left: 20 }, wind: { takes: 8, left: 10 } }
    const { calls, text, button, settle } = render(
      list,
      effects({ rows: four }),
      undefined,
      seeds([[['effects-making'], making]]),
    )
    expect(text()).toContain('Making 16 takes for 2 effects · about 30 s left')
    expect(text()).not.toContain('Make 4 takes each')
    act(() => button('Stop all').click())
    await settle()
    expect(posts(calls).map((c) => c.url)).toContain('/api/effects/stop-all')
  })

  it('says how it went once the last take is done, and Close puts focus on the button', async () => {
    const batch = { total: 16, made: 16, stopped: 0, failed: [], running: false }
    const { text, button, settle, calls } = render(
      list,
      effects({ rows: four }),
      undefined,
      seeds([[['effects-batch'], batch]]),
    )
    expect(text()).toContain('Made 16 of 16 takes.')
    expect(text()).not.toContain('Make 4 takes each')
    act(() => button('Close').click())
    await settle()
    expect(posts(calls).map((c) => c.url)).toContain('/api/effects/batch/close')
    expect(text()).not.toContain('Made 16 of 16 takes.')
    expect(document.activeElement).toBe(button('Make 4 takes each'))
  })

  it('names an effect with a failed take and links its page, and says what was stopped', () => {
    const batch = {
      total: 16,
      made: 4,
      stopped: 10,
      failed: [
        { id: 'thunder', n: 1 },
        { id: 'thunder', n: 2 },
      ],
      running: false,
    }
    const { container, text } = render(
      list,
      effects({ rows: four }),
      undefined,
      seeds([[['effects-batch'], batch]]),
    )
    expect(text()).toContain(
      'Made 4 of 16 takes. 2 could not be made — Thunder says why. 10 were stopped.',
    )
    expect(container.querySelector('.effects-make-all-summary a')!.getAttribute('href')).toBe(
      '#/effects/items/thunder',
    )
  })

  it('does not bring the question back after takes started elsewhere have ended', async () => {
    const { client, text, button, settle } = render(
      list,
      effects({ rows: four }),
      undefined,
      seeds(),
    )
    act(() => button('Make 4 takes each').click())
    act(() => client.setQueryData(['effects-making'], { coins: { takes: 1, left: 2 } }))
    await settle()
    expect(text()).not.toContain('Make 16 takes for 4 effects?')
    act(() => client.setQueryData(['effects-making'], {}))
    await settle()
    expect(text()).not.toContain('Make 16 takes for 4 effects?')
    expect(button('Make 4 takes each')).toBeDefined()
  })

  describe('focus after Stop all', () => {
    const making = { coins: { takes: 8, left: 20 } }
    const batch = { total: 8, made: 0, stopped: 0, failed: [], running: false }
    const withBatch = () =>
      seeds([
        [['effects-making'], making],
        [['effects-batch'], batch],
        [['effects-summary-open'], true],
      ])
    // happy-dom moves focus on by itself when the focused node is removed (a browser drops it to
    // the body), so these tests record the focus() calls, though the first two cannot go red here.
    const focused: Element[] = []
    const realFocus = HTMLElement.prototype.focus
    beforeEach(() => {
      focused.length = 0
      HTMLElement.prototype.focus = function (this: HTMLElement) {
        focused.push(this)
        realFocus.call(this)
      }
    })
    afterEach(() => {
      HTMLElement.prototype.focus = realFocus
    })

    it('keeps focus on a greyed Stop all while stopping, then moves it to Close', async () => {
      let release = () => {}
      const { client, button, settle } = render(
        list,
        effects({ rows: four }),
        (call) =>
          call.url.endsWith('/stop-all')
            ? new Promise<Response>((resolve) => {
                release = () => resolve(Response.json({ ok: true }))
              })
            : Response.json({ ok: true }),
        withBatch(),
      )
      button('Stop all').focus()
      act(() => button('Stop all').click())
      await settle()
      expect(button('Stop all').getAttribute('aria-disabled')).toBe('true')
      expect((button('Stop all') as HTMLButtonElement).disabled).toBe(false)
      expect(document.activeElement).toBe(button('Stop all'))
      await act(async () => release())
      act(() => client.setQueryData(['effects-making'], {}))
      await settle()
      expect(focused.at(-1)).toBe(button('Close'))
      act(() => button('Close').click())
      await settle()
      expect(document.activeElement).toBe(button('Make 4 takes each'))
    })

    it('goes to the panel button when there is no summary to show', async () => {
      const { client, button, settle } = render(
        list,
        effects({ rows: four }),
        undefined,
        seeds([[['effects-making'], making]]),
      )
      button('Stop all').focus()
      act(() => client.setQueryData(['effects-making'], {}))
      await settle()
      expect(focused.at(-1)).toBe(button('Make 4 takes each'))
    })

    it('moves focus when the takes finish on their own only if it was on Stop all', async () => {
      const on = render(list, effects({ rows: four }), undefined, withBatch())
      on.button('Stop all').focus()
      act(() => on.client.setQueryData(['effects-making'], {}))
      await on.settle()
      expect(focused.at(-1)).toBe(on.button('Close'))
      const elsewhere = render(list, effects({ rows: four }), undefined, withBatch())
      const other = document.createElement('input')
      document.body.append(other)
      other.focus()
      focused.length = 0
      act(() => elsewhere.client.setQueryData(['effects-making'], {}))
      await elsewhere.settle()
      expect(focused).toEqual([])
      expect(document.activeElement).toBe(other)
    })

    it('waits for the summary before moving focus when the batch ends after the takes', async () => {
      const { client, button, settle } = render(
        list,
        effects({ rows: four }),
        undefined,
        seeds([
          [['effects-making'], making],
          [['effects-batch'], { ...batch, running: true }],
          [['effects-summary-open'], true],
        ]),
      )
      button('Stop all').focus()
      act(() => client.setQueryData(['effects-making'], {}))
      await settle()
      expect(button('Close')).toBeUndefined()
      expect(focused.at(-1)).not.toBe(button('Make 4 takes each'))
      act(() => client.setQueryData(['effects-batch'], batch))
      await settle()
      expect(focused.at(-1)).toBe(button('Close'))
    })

    it('says when stopping failed, keeps Stop all and its focus, and clears the line when the takes finish', async () => {
      let answer = (call: { url: string }): Response | Promise<Response> =>
        call.url.endsWith('/stop-all') ? new Response('{}', { status: 500 }) : Response.json({})
      const { client, text, button, settle } = render(
        list,
        effects({ rows: four }),
        (call) => answer(call),
        withBatch(),
      )
      button('Stop all').focus()
      act(() => button('Stop all').click())
      await settle()
      const words = 'The takes could not be stopped. They are still being made; try again.'
      expect(text()).toContain(words)
      expect(document.activeElement).toBe(button('Stop all'))
      act(() => {
        answer = () => new Promise<Response>(() => {})
        button('Stop all').click()
      })
      await settle()
      expect(text()).not.toContain(words)
      act(() => client.setQueryData(['effects-making'], {}))
      await settle()
      expect(text()).not.toContain(words)
    })
  })

  it('Close puts focus on the panel when no button is left', async () => {
    const batch = { total: 4, made: 4, stopped: 0, failed: [], running: false }
    const { container, button, settle } = render(
      list,
      effects({ rows: [chosen('a'), chosen('b')] }),
      undefined,
      seeds([[['effects-batch'], batch]]),
    )
    act(() => button('Close').click())
    await settle()
    expect(document.activeElement).toBe(container.querySelector('.status-panel'))
  })

  it('shows the summary on a page that never saw the takes made (a reload, a new tab)', () => {
    const batch = { total: 16, made: 16, stopped: 0, failed: [], running: false }
    const { text } = render(
      list,
      effects({ rows: four }),
      undefined,
      seeds([[['effects-batch'], batch]]),
    )
    expect(text()).toContain('Made 16 of 16 takes.')
  })
})
