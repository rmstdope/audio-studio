import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ImagePatchesView, PatchWorkView, RemakePressView } from '../../../core/imagePatches'
import type { ImageRow, PatchRow } from '../../../core/images'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const isOff = (element: Element) => element.getAttribute('aria-disabled') === 'true'
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

const area = { x: 10, y: 10, width: 100, height: 100 }
const patch = (id: string, over: Partial<PatchRow> = {}): PatchRow => ({
  id,
  title: id === 'door' ? 'Door open' : id === 'lamp' ? 'Lamp lit' : 'Bread taken',
  description: `Words of ${id}`,
  words: `Words of ${id}`,
  changed: false,
  gameChanged: false,
  gameWas: null,
  chosenOn: [3],
  chosenOnGone: false,
  chosenArea: null,
  ...over,
})
const idle = (id: string, over: Partial<PatchWorkView> = {}): PatchWorkView => ({
  id,
  takes: [],
  making: [],
  failed: [],
  oldLook: false,
  failedModels: [],
  ...over,
})
const press = (over: Partial<RemakePressView> = {}): RemakePressView => ({
  total: 6,
  ids: ['bread', 'door', 'lamp'],
  failedTakes: 0,
  made: 0,
  stopped: 0,
  failed: [],
  running: false,
  left: 120,
  model: 'klein',
  ...over,
})

/** Renders the panel on take 4 of an image; `sent` records every POST. */
async function render({
  patches = [patch('bread'), patch('door'), patch('lamp')],
  work = patches.map((p) => idle(p.id)),
  earlier = { bread: area, door: area, lamp: area } as Record<string, typeof area>,
  pressed = null,
  chosenTake = 4,
  maker = { ok: true } as ImagePatchesView['maker'],
  pictureGone = false,
  post = { status: 200, body: { ok: true } },
  models = { 'qwen-edit': 'whole', klein: 'whole' } as ImagePatchesView['models'],
  failedModels = [] as ImagePatchesView['remake']['failedModels'],
}: {
  patches?: PatchRow[]
  work?: PatchWorkView[]
  earlier?: Record<string, typeof area>
  pressed?: RemakePressView | null
  chosenTake?: number | null
  maker?: ImagePatchesView['maker']
  pictureGone?: boolean
  post?: { status: number; body: unknown }
  models?: ImagePatchesView['models']
  failedModels?: ImagePatchesView['remake']['failedModels']
} = {}) {
  const sent: { path: string; body: unknown }[] = []
  let current = pressed
  globalThis.fetch = (async (path: string, init?: RequestInit) => {
    if (path.split('?')[0] === '/api/images/inn/patches') {
      return Response.json({
        ok: true,
        take:
          chosenTake === null ? null : { n: chosenTake, width: 1024, height: 640, cropped: false },
        game: { width: 640, height: 400 },
        lookError: null,
        lookKey: 'k',
        lockUnread: false,
        pictureGone,
        maker,
        models,
        patches: work,
        remake: { earlier, press: current, failedModels },
      })
    }
    if (path.endsWith('/remake/close')) current = null
    // The menus ask what a take is timed at; that is not a press.
    if (!path.endsWith('/take-times'))
      sent.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null })
    return Response.json(post.body, { status: post.status })
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
        createElement(GamePatchesPanel, {
          row: {
            id: 'inn',
            width: 640,
            height: 400,
            chosenTake,
            areas: [],
            patches,
          } as unknown as ImageRow,
        }),
      ),
    )
  })
  await act(async () => await new Promise((r) => setTimeout(r, 10)))
  cleanups.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  return { host, sent }
}

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
const button = (host: Element, label: string) =>
  [...host.querySelectorAll('button')].find((b) => text(b) === label) as HTMLButtonElement
const lines = (host: Element) => text(host.querySelector('.remake, .remake-line, .remake-leftout'))

describe('the Remake patches line', () => {
  it('counts the covered patches, with the menu, the press and what it uses', async () => {
    const { host } = await render()
    expect(lines(host)).toContain('3 patches to make again on take 4')
    const options = [
      ...host.querySelectorAll('select[aria-label="Takes of each patch"] option'),
    ].map((o) => text(o))
    expect(options).toEqual(['1 take each', '2 takes each', '3 takes each', '4 takes each'])
    expect(
      (host.querySelector('select[aria-label="Takes of each patch"]') as HTMLSelectElement).value,
    ).toBe('2')
    expect(button(host, 'Remake patches on this take')).toBeTruthy()
    expect(lines(host)).toContain(
      'Each from the area and words it was chosen with. You still choose each one: the new picture may have moved what the area covered.',
    )
  })

  it('uses the singular for one patch', async () => {
    const { host } = await render({ patches: [patch('door')] })
    expect(lines(host)).toContain('1 patch to make again on take 4')
  })

  it('is not there when no patch is marked, when every marked patch has takes, or when no take is chosen', async () => {
    expect(lines((await render({ patches: [patch('door', { chosenOn: [] })] })).host)).toBe('')
    const has = await render({
      patches: [patch('door')],
      work: [idle('door', { takes: [{ n: 1 } as never] })],
    })
    expect(lines(has.host)).toBe('')
    expect(lines((await render({ chosenTake: null })).host)).toBe('')
  })

  it('presses with the chosen number and the marks, and moves focus to Stop', async () => {
    const { host, sent } = await render({ patches: [patch('door')] })
    await act(async () => {
      const select = host.querySelector(
        'select[aria-label="Takes of each patch"]',
      ) as HTMLSelectElement
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      set.call(select, '3')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => button(host, 'Remake patches on this take').click())
    expect(sent[0]).toEqual({
      path: '/api/images/inn/patches/remake',
      body: { count: 3, marks: {}, model: 'klein' },
    })
  })

  it('names a patch with no area, leaves it out of the count, and keeps the press for the rest', async () => {
    const { host } = await render({ earlier: { door: area, lamp: area } })
    expect(lines(host)).toContain('2 patches to make again on take 4')
    expect(lines(host)).toContain(
      'Bread taken gets none: its area is gone with the take it was made on. Open it and mark the area.',
    )
  })

  it('names several left out in one sentence', async () => {
    const { host } = await render({ earlier: { door: area } })
    expect(lines(host)).toContain(
      'Bread taken and Lamp lit get none: their areas are gone with the takes they were made on. Open them and mark the areas.',
    )
  })

  it('has no menu and no press when every covered patch is left out', async () => {
    const one = await render({ patches: [patch('bread')], earlier: {} })
    expect(text(one.host.querySelector('.remake-leftout'))).toBe(
      'Bread taken has no area to make it from: open it and mark one.',
    )
    expect(one.host.querySelector('select')).toBeNull()
    const two = await render({ earlier: {} })
    expect(text(two.host.querySelector('.remake-leftout'))).toBe(
      'Bread taken, Door open and Lamp lit have no area to make them from: open them and mark one each.',
    )
  })

  it('turns the press off, with the reason, when the model is missing or the picture is gone', async () => {
    const off = await render({
      maker: {
        ok: false,
        message: 'FLUX.2 klein 4B is not on this computer, and patches are made with it.',
      },
    })
    expect(isOff(button(off.host, 'Remake patches on this take'))).toBe(true)
    expect(lines(off.host)).toContain('FLUX.2 klein 4B is not on this computer')
    expect(lines(off.host)).toContain('3 patches to make again on take 4')
    const gone = await render({ pictureGone: true })
    expect(isOff(button(gone.host, 'Remake patches on this take'))).toBe(true)
    expect(lines(gone.host)).toContain(
      "The chosen take's picture is missing or cannot be read, so it cannot be patched.",
    )
  })

  it('says the takes could not be started when the press is refused', async () => {
    const { host } = await render({ post: { status: 409, body: { ok: false, message: 'no' } } })
    await act(async () => button(host, 'Remake patches on this take').click())
    expect(text(host.querySelector('[role="alert"]'))).toBe(
      'The takes could not be started. Nothing was made; try again.',
    )
    expect(button(host, 'Remake patches on this take')).toBeTruthy()
  })
})

describe('the press while it runs and after', () => {
  const making = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      n: i + 1,
      state: i === 0 ? 'making' : 'waiting',
      elapsed: 5,
      expected: 15,
      area,
      model: 'klein',
    })) as never

  const waiting = [
    { n: 1, state: 'waiting', elapsed: 0, expected: 15, area, model: 'klein' },
  ] as never

  it('says seconds when under a minute is left', async () => {
    const { host } = await render({ pressed: press({ running: true, left: 40 }) })
    expect(lines(host)).toContain(
      'Making 6 takes for 3 patches with FLUX.2 klein · about 40 s left',
    )
  })

  it('becomes a progress line with Stop, and rows say how far each has come', async () => {
    const { host, sent } = await render({
      pressed: press({ running: true }),
      work: [
        idle('bread', { making: making(2) }),
        idle('door', { making: waiting }),
        idle('lamp', { making: waiting }),
      ],
    })
    expect(lines(host)).toBe(
      'Making 6 takes for 3 patches with FLUX.2 klein · about 2 min leftStop',
    )
    expect(host.querySelector('select')).toBeNull()
    const rows = [...host.querySelectorAll('button.game-patch-row')].map((r) => text(r))
    expect(rows[0]).toContain('Making 2 takes')
    expect(rows[1]).toContain('Waiting')
    expect(host.querySelectorAll('button[aria-expanded="true"]').length).toBe(0)
    await act(async () => button(host, 'Stop').click())
    expect(sent[0]!.path).toBe('/api/images/inn/patches/remake/stop')
  })

  it('becomes a summary with Close, and the rows read as agreed with "new"', async () => {
    const takes = [
      { n: 1, isNew: true },
      { n: 2, isNew: true },
    ] as never
    const { host, sent } = await render({
      pressed: press({ made: 6 }),
      work: [idle('bread', { takes }), idle('door', { takes }), idle('lamp', { takes })],
    })
    expect(lines(host)).toBe(
      'Made 6 of 6 takes. Choose one for each patch to put it back in the game.Close',
    )
    const first = host.querySelector('button.game-patch-row')!
    expect(text(first)).toContain('2 takes, none chosen')
    expect(text(first)).toContain('new')
    expect(text(first)).toContain('Make again')
    await act(async () => button(host, 'Close').click())
    await act(async () => await new Promise((r) => setTimeout(r, 10)))
    expect(sent[0]!.path).toBe('/api/images/inn/patches/remake/close')
    expect(document.activeElement).toBe(first)
  })

  it('has its own words for one patch, for stopped takes, and for a failure that names the patch', async () => {
    const one = await render({
      patches: [patch('door')],
      pressed: press({ total: 2, made: 2, ids: ['door'] }),
    })
    expect(lines(one.host)).toContain(
      'Made 2 of 2 takes. Choose one to put the patch back in the game.',
    )
    const stopped = await render({ pressed: press({ made: 2, stopped: 4 }) })
    expect(lines(stopped.host)).toContain('Made 2 of 6 takes. 4 were stopped.')
    const failed = await render({
      pressed: press({ made: 5, failedTakes: 1, failed: ['door'] }),
      work: [
        idle('bread'),
        idle('door', { failed: [{ n: 1, message: 'boom', area, model: 'klein' }] }),
        idle('lamp'),
      ],
    })
    expect(lines(failed.host)).toContain(
      'Made 5 of 6 takes. 1 could not be made — Door open says why.',
    )
    const rows = [...failed.host.querySelectorAll('button.game-patch-row')].map((r) => text(r))
    expect(rows[1]).toContain('no takes yet · 1 could not be made')
  })

  it('opens the failed patch’s row from the summary', async () => {
    const { host } = await render({
      pressed: press({ made: 5, failedTakes: 1, failed: ['door'] }),
      work: [
        idle('bread'),
        idle('door', { failed: [{ n: 1, message: 'boom', area, model: 'klein' }] }),
        idle('lamp'),
      ],
    })
    const link = [...host.querySelectorAll('.remake-line button.link-button')][0]!
    expect(text(link)).toBe('Door open')
    await act(async () => (link as HTMLButtonElement).click())
    expect(host.querySelectorAll('button.game-patch-row')[1]!.getAttribute('aria-expanded')).toBe(
      'true',
    )
  })

  it('says "Made 0 of 6 takes." when nothing could be made', async () => {
    const { host } = await render({
      pressed: press({ made: 0, failedTakes: 6, failed: ['bread', 'door', 'lamp'] }),
    })
    expect(lines(host)).toContain(
      'Made 0 of 6 takes. 6 could not be made — Bread taken, Door open, Lamp lit say why.',
    )
  })
})

describe('the model of the remake', () => {
  const MODEL = 'select[aria-label="Model for the new takes of each patch"]'
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
  const menu = (host: Element) => host.querySelector(MODEL) as HTMLSelectElement
  const pick = (m: HTMLSelectElement, value: string) =>
    act(async () => {
      set.call(m, value)
      m.dispatchEvent(new Event('change', { bubbles: true }))
    })

  it('has its own menu on its line, with the two models, starting on klein', async () => {
    const { host } = await render()
    expect([...menu(host).options].map((o) => text(o))).toEqual([
      'FLUX.2 klein 4B — a guess: about 20 s a take',
      'Qwen Image Edit — a guess: about 8 min a take',
    ])
    expect(menu(host).value).toBe('klein')
    expect(menu(host).closest('.remake-line')).not.toBeNull()
  })

  it('makes every take with the model picked', async () => {
    const { host, sent } = await render({ patches: [patch('door')] })
    await pick(menu(host), 'qwen-edit')
    await act(async () => button(host, 'Remake patches on this take').click())
    expect(sent[0]!.body).toEqual({ count: 2, marks: {}, model: 'qwen-edit' })
  })

  it('starts on Qwen when klein is not here and Qwen is', async () => {
    const { host } = await render({ models: { 'qwen-edit': 'whole', klein: 'absent' } })
    expect(menu(host).value).toBe('qwen-edit')
    expect(isOff(button(host, 'Remake patches on this take'))).toBe(false)
  })

  it('starts on klein with no line about Qwen when Qwen is absent', async () => {
    const { host } = await render({ models: { 'qwen-edit': 'absent', klein: 'whole' } })
    expect(menu(host).value).toBe('klein')
    expect(text(host)).not.toContain('so these takes use')
    expect(text(host)).not.toContain('Setup says how')
    expect(isOff(button(host, 'Remake patches on this take'))).toBe(false)
  })

  it('turns the button off and points to Setup when the model picked is not here', async () => {
    const { host } = await render({ models: { 'qwen-edit': 'absent', klein: 'whole' } })
    await pick(menu(host), 'qwen-edit')
    expect(text(menu(host).closest('.edit-model'))).toContain('not on this computer')
    expect(text(host)).toContain('Setup says how to download it.')
    expect(isOff(button(host, 'Remake patches on this take'))).toBe(true)
  })

  it('warns that the last take failed', async () => {
    const { host } = await render({ failedModels: ['qwen-edit'] })
    expect(text(menu(host).closest('.edit-model'))).toContain('last take failed')
  })

  it('names the model of the press while it runs', async () => {
    const { host } = await render({
      pressed: press({ running: true, left: 720, model: 'qwen-edit' }),
    })
    expect(lines(host)).toContain(
      'Making 6 takes for 3 patches with Qwen Image Edit · about 12 min left',
    )
  })
})
