import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { TrackRow } from '../../../core/music'
import type { MusicTakesView, TakeView } from '../../../core/musicTake'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const isOff = (element: Element) => element.getAttribute('aria-disabled') === 'true'
const { act, createElement } = await import('react')
const { WhyTip } = await import('../../components/WhyTip')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { TakesPanel } = await import('./TakesPanel')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterAll(() => {
  cleanups.forEach((c) => c())
  GlobalRegistrator.unregister()
})

const track: TrackRow = {
  id: 'victory',
  title: 'Victory',
  plays: null,
  brief: 'fanfare',
  seconds: 10,
  bpm: null,
  key: null,
  game: { brief: 'fanfare', seconds: 10, bpm: null, key: null },
  gameChanged: false,
  gameWas: null,
  status: 'not-chosen',
  changed: [],
  chosenAt: null,
  current: { kind: 'none' },
  gameFile: null,
}
const inGame: TrackRow = {
  ...track,
  status: 'chosen',
  current: { kind: 'take', take: 1, exists: true },
}

const take = (n: number, over: Partial<TakeView> = {}): TakeView => ({
  n,
  file: `aaaaaaaaaaaaaaaa.${n}.wav`,
  seconds: 10,
  seed: n,
  peaks: Array.from({ length: 20 }, () => 0.5),
  earlier: false,
  chosen: false,
  model: 'Balanced · XL turbo · 4B',
  trimmable: 'cut',
  ...over,
})
const view = (takes: TakeView[], kind: 'loop' | 'stinger' = 'stinger'): MusicTakesView => ({
  ok: true,
  kind,
  generator: { ok: true },
  defaultModel: 'balanced',
  models: [{ id: 'balanced', installed: true }],
  takes,
  making: [],
  failed: [],
  lockUnread: false,
})
const trimmed = { start: 1.2, end: 3, seconds: 5.8 }

let answer: () => Promise<Response>
const posted: { url: string; body: unknown }[] = []
beforeEach(() => {
  posted.length = 0
  answer = async () => new Response(JSON.stringify({ ok: true }))
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (init?.method === 'POST')
      posted.push({ url: String(url), body: JSON.parse(String(init.body)) })
    return answer()
  }) as typeof fetch
})

function render(data: MusicTakesView, row: TrackRow = track) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(['music-takes', 'victory'], data)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(WhyTip),
        createElement(TakesPanel, { track: row, lists: [] }),
      ),
    ),
  )
  const buttons = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => b.textContent === name,
    )
  return { container, buttons }
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('Trim silence on a stinger’s takes', () => {
  it('is on every stinger card, and never on a loop’s', () => {
    expect(render(view([take(1), take(2)])).buttons('Trim silence')).toHaveLength(2)
    expect(
      render(view([{ ...take(1), trimmable: undefined }], 'loop')).buttons('Trim silence'),
    ).toHaveLength(0)
  })

  it('sits at the left of the bottom row, before Fades…, Move…, Drop and Choose', () => {
    const { container } = render(view([take(1)]))
    const row = [...container.querySelectorAll('.take-row')].find((r) =>
      [...r.querySelectorAll('button')].some((b) => b.textContent === 'Choose'),
    )!
    expect([...row.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Trim silence',
      'Fades…',
      'Move…',
      'Drop',
      'Choose',
    ])
  })

  it('waits while the music lock cannot be read, like Choose', () => {
    const { buttons } = render({ ...view([take(1)]), lockUnread: true })
    expect(isOff(buttons('Trim silence')[0]!)).toBe(true)
  })

  it('asks the server to trim the take, and stays on the button that now reads Undo trim', async () => {
    const { container, buttons } = render(view([take(1)]))
    const button = buttons('Trim silence')[0]!
    button.focus()
    await click(button)
    expect(posted).toEqual([
      {
        url: '/api/music/tracks/victory/trim',
        body: { file: 'aaaaaaaaaaaaaaaa.1.wav', undo: false },
      },
    ])
    expect(container.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(button)
  })

  it('reads Trimming… and cannot be pressed again while it works, keeping focus', async () => {
    let finish = () => {}
    answer = () =>
      new Promise((resolve) => (finish = () => resolve(new Response(JSON.stringify({ ok: true })))))
    const { buttons } = render(view([take(1)]))
    const button = buttons('Trim silence')[0]!
    button.focus()
    await click(button)
    const working = buttons('Trimming…')[0]!
    expect(working).toBe(button)
    expect(working.getAttribute('aria-disabled')).toBe('true')
    await click(working)
    expect(posted).toHaveLength(1)
    expect(document.activeElement).toBe(button)
    await act(async () => finish())
  })

  it('shows a trimmed card: tag, new length, the cut line, Undo trim, and the full waveform with hatched ends', () => {
    const { container, buttons } = render(view([take(1, { trim: trimmed, trimmable: undefined })]))
    expect(container.querySelector('.take-tag')?.textContent).toBe('trimmed')
    expect(container.textContent).toContain('0:05.8')
    expect(container.textContent).toContain('1.2 s cut from the start, 3.0 s from the end')
    expect(buttons('Undo trim')).toHaveLength(1)
    expect(buttons('Trim silence')).toHaveLength(0)
    const zones = [...container.querySelectorAll<HTMLElement>('.wave .cutzone')]
    expect(zones.map((z) => z.style.width)).toEqual(['12%', '30%'])
    expect(container.querySelectorAll('.wave i')).toHaveLength(20)
  })

  it('plays only the part between the cuts of a trimmed take', async () => {
    const { takeSoundUrl } = await import('./trimSilence')
    expect(takeSoundUrl('victory', take(1, { trim: trimmed }))).toBe(
      '/api/music/tracks/victory/takes/aaaaaaaaaaaaaaaa.1.wav?trimmed=1',
    )
    expect(takeSoundUrl('victory', take(1))).toBe(
      '/api/music/tracks/victory/takes/aaaaaaaaaaaaaaaa.1.wav',
    )
  })

  it('undoes a trim', async () => {
    const { buttons } = render(view([take(1, { trim: trimmed, trimmable: undefined })]))
    await click(buttons('Undo trim')[0]!)
    expect(posted[0]!.body).toEqual({ file: 'aaaaaaaaaaaaaaaa.1.wav', undo: true })
  })

  it('is greyed out with the reason when there is nothing to cut, and when it is near-silent throughout', () => {
    const nothing = render(view([take(1, { trimmable: 'nothing' })]))
    const a = nothing.buttons('Trim silence')[0]!
    expect(isOff(a)).toBe(true)
    expect(nothing.container.textContent).toContain('Starts and ends on its sound: nothing to cut.')
    const silent = render(view([take(2, { trimmable: 'silent' })]))
    expect(isOff(silent.buttons('Trim silence')[0]!)).toBe(true)
    expect(silent.container.textContent).toContain(
      'Near-silent throughout: there is no sound to keep.',
    )
  })

  it('says a failed trim on the card, as it was, and the button can be pressed again', async () => {
    answer = async () =>
      new Response(
        JSON.stringify({ ok: false, message: 'The take’s sound file could not be read.' }),
        {
          status: 409,
        },
      )
    const { container, buttons } = render(view([take(6)]))
    const button = buttons('Trim silence')[0]!
    button.focus()
    await click(button)
    expect(container.querySelector('.adopt-error')?.textContent).toBe(
      'Take 6 could not be trimmed: the take’s sound file could not be read. The take is as it was.',
    )
    expect(button.getAttribute('aria-disabled')).not.toBe('true')
    expect(document.activeElement).toBe(button)
  })

  it('names what the game still plays when the take in the game could not be trimmed or untrimmed', async () => {
    answer = async () =>
      new Response(
        JSON.stringify({ ok: false, message: 'The game’s file could not be written.' }),
        {
          status: 409,
        },
      )
    const a = render(view([take(1, { chosen: true })]), inGame)
    await click(a.buttons('Trim silence')[0]!)
    expect(a.container.querySelector('.track-in-game .adopt-error')?.textContent).toBe(
      'Take 1 could not be trimmed: the game’s file could not be written. The game still plays it as it was.',
    )
    const b = render(view([take(1, { chosen: true, trim: trimmed, trimmable: undefined })]), inGame)
    await click(b.buttons('Undo trim')[0]!)
    expect(b.container.querySelector('.track-in-game .adopt-error')?.textContent).toBe(
      'Take 1 could not be untrimmed: the game’s file could not be written. The game still plays it trimmed.',
    )
  })

  it('is on the take in the game too, with the trimmed tag before the chosen chip', () => {
    const { container, buttons } = render(
      view([take(1, { chosen: true, trim: trimmed, trimmable: undefined })]),
      inGame,
    )
    const block = container.querySelector('.track-in-game')!
    expect(block.querySelector('.take-tag')?.textContent).toBe('trimmed')
    const head = block.querySelector('.take-row')!
    expect(head.textContent).toMatch(/trimmed.*chosen/)
    expect(block.textContent).toContain('1.2 s cut from the start, 3.0 s from the end')
    expect(buttons('Undo trim')).toHaveLength(1)
    expect(block.contains(buttons('Undo trim')[0]!)).toBe(true)
  })
})

describe('where a trimmed take’s playhead is', () => {
  it('maps the part between the cuts onto the full-width waveform', async () => {
    const { wavePosition } = await import('./trimSilence')
    const at = (x: number | null) => wavePosition(take(1, { trim: trimmed }), () => x)
    expect(at(0)()).toBeCloseTo(0.12, 6)
    expect(at(1)()).toBeCloseTo(0.7, 6)
    expect(at(null)()).toBeNull()
    expect(wavePosition(take(1), () => 0.4)()).toBe(0.4)
  })
})
