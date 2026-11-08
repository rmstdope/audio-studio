import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ImageModelId, ImageModelState } from '../../../core/imageModels'
import type { ImageMakingSummary } from '../../../core/imageTakes'
import type { ImageConflict, ImageRow, ImagesAct } from '../../../core/images'
import type { ImagesBatch } from '../../api'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { MakeAllPanel } = await import('./MakeAllPanel')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
const realFetch = globalThis.fetch
afterAll(() => {
  globalThis.fetch = realFetch
  cleanups.forEach((c) => c())
  GlobalRegistrator.unregister()
})

const image = (id: string, title: string, status: ImageRow['status'] = 'none yet'): ImageRow =>
  ({ id, title, status }) as ImageRow

const conflict = (id: string, title: string): ImageConflict =>
  ({ id, title, acts: [], differs: ['words'] }) as ImageConflict

const actOf = (rows: ImageRow[], conflicts: ImageConflict[] = []): ImagesAct =>
  ({
    id: 'act1',
    title: 'Act I',
    state: 'ok',
    rows,
    conflicts,
    order: [...rows.map((r) => r.id), ...conflicts.map((c) => c.id)],
  }) as unknown as ImagesAct

const three = actOf([
  image('lighthouse', 'Lighthouse'),
  image('cave', 'Cave entrance'),
  image('inn', 'Inn'),
  image('market', 'Fish market', 'chosen'),
  image('cabin', "Captain's cabin", 'out of date'),
])

const whole: ImageModelState = { download: 'whole', failed: false }

interface Options {
  making?: Record<string, ImageMakingSummary>
  main?: ImageModelId
  states?: Record<ImageModelId, ImageModelState>
  ready?: boolean
  batch?: ImagesBatch
  answer?: { status: number }
  started?: Record<string, ImageMakingSummary>
  /** Whether Stop all is refused. */
  stopFails?: boolean
}

/** The panel on an act, with what the server would have said, and the requests it makes. */
function render(subject: ImagesAct, options: Options = {}) {
  const requests: { url: string; method: string }[] = []
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url: String(url), method: init?.method ?? 'GET' })
    if (String(url).endsWith('/stop')) {
      if (options.stopFails) return new Response('{}', { status: 500 })
      return new Response(JSON.stringify({ ok: true, stopped: 2 }), { status: 200 })
    }
    if (options.started && String(url).endsWith('/make-all')) {
      client.setQueryData(['image-making'], options.started)
    }
    const body = String(url).endsWith('/make-all')
      ? { ok: true, images: ['lighthouse', 'cave', 'inn'], takes: 12 }
      : { ok: true }
    return new Response(JSON.stringify(body), { status: options.answer?.status ?? 200 })
  }) as unknown as typeof fetch
  client.setQueryData(['image-making'], options.making ?? {})
  client.setQueryData(['image-model-state'], {
    ok: true,
    main: options.main ?? 'klein',
    ready: options.ready ?? true,
    states: options.states ?? { klein: whole, 'z-image-turbo': whole },
  })
  if (options.batch) client.setQueryData(['images-batch', subject.id], options.batch)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(MakeAllPanel, {
          act: subject,
          children: createElement('div', null, 'COUNT'),
        }),
      ),
    ),
  )
  const button = (name: string): HTMLButtonElement =>
    [...container.querySelectorAll<HTMLElement>('button, a')].find(
      (b) => b.textContent === name,
    ) as HTMLButtonElement
  const press = async (name: string) => {
    await act(async () => {
      button(name).click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  return { container, client, requests, button, press, text: () => container.textContent ?? '' }
}

describe('Make takes for every image with no chosen take', () => {
  it('offers four takes for each image with no chosen take, and starts nothing by itself', () => {
    const page = render(three)
    expect(page.text()).toContain('3 images have no chosen take')
    expect(page.button('Make 4 takes each')).toBeDefined()
    expect(page.requests).toEqual([])
  })

  it('asks first, naming the images, the model and who is left out, with focus on Make', async () => {
    const page = render(three)
    await page.press('Make 4 takes each')
    expect(page.text()).toContain('Make 12 takes for 3 images?')
    expect(page.text()).toContain(
      'Four takes each, on FLUX.2 klein, the image model on Setup. About 2 min in all',
    )
    expect(page.text()).toContain('Lighthouse')
    expect(page.text()).toContain(
      "Fish market and Captain's cabin have a chosen take and get none.",
    )
    expect(page.requests).toEqual([])
    expect(document.activeElement).toBe(page.button('Make 12 takes'))
  })

  it('names the images the game’s lists disagree about as left out', async () => {
    const page = render(
      actOf([image('a', 'Lighthouse'), image('c', 'Inn')], [conflict('x', "Smugglers' cave")]),
    )
    expect(page.text()).toContain('2 images have no chosen take')
    await page.press('Make 4 takes each')
    expect(page.text()).toContain("Smugglers' cave gets none: the game's lists disagree about it.")
  })

  it('names the other model and why when Setup’s is not usable', async () => {
    const page = render(three, {
      states: { klein: { download: 'partial', failed: false }, 'z-image-turbo': whole },
    })
    await page.press('Make 4 takes each')
    expect(page.text()).toContain(
      'Four takes each, on Z-Image-Turbo: FLUX.2 klein, the image model on Setup, is only partly downloaded. About 12 min in all',
    )
  })

  it('closes on Cancel and on Esc, writes nothing, and puts focus back on the button', async () => {
    const page = render(three)
    await page.press('Make 4 takes each')
    await page.press('Cancel')
    expect(page.text()).not.toContain('Make 12 takes for 3 images?')
    expect(document.activeElement).toBe(page.button('Make 4 takes each'))
    await page.press('Make 4 takes each')
    await act(async () => {
      page.container
        .querySelector('.make-all-question')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(page.text()).not.toContain('Make 12 takes for 3 images?')
    expect(page.requests).toEqual([])
  })

  it('asks the server on Make, closes the question and moves focus to Stop all', async () => {
    const started = {
      lighthouse: { takes: 4, left: 32, failed: 0, stopped: 0 },
      cave: { takes: 4, left: 32, failed: 0, stopped: 0 },
      inn: { takes: 4, left: 32, failed: 0, stopped: 0 },
    }
    const page = render(three, { started })
    await page.press('Make 4 takes each')
    await page.press('Make 12 takes')
    expect(page.requests).toEqual([{ url: '/api/image-acts/act1/make-all', method: 'POST' }])
    expect(page.text()).toContain('Making 12 takes for 3 images · about 2 min left')
    expect(page.text()).not.toContain('Make 4 takes each')
    expect(document.activeElement).toBe(page.button('Stop all'))
  })

  it('shows a red line and keeps the button when the takes could not be started', async () => {
    const page = render(three, { answer: { status: 409 } })
    await page.press('Make 4 takes each')
    await page.press('Make 12 takes')
    expect(page.text()).toContain('The takes could not be started. Nothing was made; try again.')
    expect(page.container.querySelector('[role="alert"]')).not.toBeNull()
    expect(page.button('Make 4 takes each')).toBeDefined()
    expect(page.text()).not.toContain('Make 12 takes for 3 images?')
  })

  it('shows what is running in the act, from what is being made, after a reload', () => {
    const page = render(three, {
      making: {
        cave: { takes: 3, left: 100, failed: 0, stopped: 0 },
        elsewhere: { takes: 9, left: 9, failed: 0, stopped: 0 },
      },
    })
    expect(page.text()).toContain('Making 3 takes for 1 image · about 2 min left')
    expect(page.button('Stop all')).toBeDefined()
    expect(page.text()).not.toContain('Make 4 takes each')
  })

  it('stops all with one request', async () => {
    const page = render(three, {
      making: { lighthouse: { takes: 2, left: 16, failed: 0, stopped: 0 } },
    })
    await page.press('Stop all')
    expect(page.requests).toEqual([{ url: '/api/image-acts/act1/stop', method: 'POST' }])
  })

  it('asks the studio to make them, and reads the press from the studio afterwards', async () => {
    const page = render(three, {
      started: { lighthouse: { takes: 4, left: 32, failed: 0, stopped: 0 } },
    })
    await page.press('Make 4 takes each')
    await page.press('Make 12 takes')
    expect(page.requests[0]).toEqual({ url: '/api/image-acts/act1/make-all', method: 'POST' })
    expect(page.client.getQueryState(['images-batch', 'act1'])?.isInvalidated).toBe(true)
  })

  it('does not bring the question back when takes started elsewhere have finished', async () => {
    const page = render(three)
    await page.press('Make 4 takes each')
    await act(async () => {
      page.client.setQueryData(['image-making'], {
        cave: { takes: 1, left: 8, failed: 0, stopped: 0 },
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(page.text()).not.toContain('Make 12 takes for 3 images?')
    await act(async () => {
      page.client.setQueryData(['image-making'], {})
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(page.text()).not.toContain('Make 12 takes for 3 images?')
    expect(page.text()).toContain('Make 4 takes each')
  })

  it('summarises a press that made everything, and Close removes it and returns focus', async () => {
    const page = render(three, {
      batch: {
        total: 12,
        images: ['lighthouse', 'cave', 'inn'],
        failedBefore: {},
        stoppedBefore: {},
        running: false,
      },
    })
    expect(page.text()).toContain('Made 12 of 12 takes.')
    await page.press('Close')
    expect(page.text()).not.toContain('Made 12 of 12 takes.')
    expect(page.requests).toContainEqual({
      url: '/api/image-acts/act1/batch/close',
      method: 'POST',
    })
    expect(document.activeElement).toBe(page.button('Make 4 takes each'))
  })

  it('shows the running line, not the summary, while the studio says the press still runs', () => {
    const page = render(three, {
      making: { cave: { takes: 1, left: 8, failed: 0, stopped: 0 } },
      batch: {
        total: 12,
        images: ['lighthouse', 'cave', 'inn'],
        failedBefore: {},
        stoppedBefore: {},
        running: true,
      },
    })
    expect(page.text()).toContain('Making 1 take for 1 image')
    expect(page.text()).not.toContain('Made 12')
  })

  it('summarises failures with a link to each image, and stopped takes after them', () => {
    const page = render(three, {
      making: {
        lighthouse: { takes: 0, left: 0, failed: 2, stopped: 0 },
        cave: { takes: 0, left: 0, failed: 0, stopped: 3 },
      },
      batch: {
        total: 12,
        images: ['lighthouse', 'cave', 'inn'],
        failedBefore: {},
        stoppedBefore: {},
        running: false,
      },
    })
    expect(page.text()).toContain(
      'Made 7 of 12 takes. 2 could not be made — Lighthouse says why. 3 were stopped.',
    )
    expect(page.container.querySelector('a[href*="lighthouse"]')).not.toBeNull()
  })

  it('does not count takes stopped before the press, or stopped from an image’s own page after it as made', () => {
    const page = render(three, {
      making: { cave: { takes: 0, left: 0, failed: 0, stopped: 6 } },
      batch: {
        total: 12,
        images: ['lighthouse', 'cave', 'inn'],
        failedBefore: {},
        stoppedBefore: { cave: 2 },
        running: false,
      },
    })
    expect(page.text()).toContain('Made 8 of 12 takes. 4 were stopped.')
  })

  it('does not count failures from before the press', () => {
    const page = render(three, {
      making: { lighthouse: { takes: 0, left: 0, failed: 1, stopped: 0 } },
      batch: {
        total: 12,
        images: ['lighthouse', 'cave', 'inn'],
        failedBefore: { lighthouse: 1 },
        stoppedBefore: {},
        running: false,
      },
    })
    expect(page.text()).toContain('Made 12 of 12 takes.')
  })

  it('says every image has a chosen take, with no button', () => {
    const page = render(actOf([image('a', 'A', 'chosen'), image('b', 'B', 'out of date')]))
    expect(page.text()).toContain('Every image has a chosen take.')
    expect(page.container.querySelector('button')).toBeNull()
  })

  it('names the images the lists disagree about instead of saying every image is chosen', () => {
    for (const rows of [[], [image('a', 'A', 'chosen')]]) {
      const page = render(actOf(rows, [conflict('x', "Smugglers' cave")]))
      expect(page.text()).not.toContain('Every image has a chosen take.')
      expect(page.text()).toContain(
        "Smugglers' cave gets none: the game's lists disagree about it.",
      )
      expect(page.container.querySelector('button')).toBeNull()
    }
  })

  it('says images cannot be made yet, with a link to Setup, when neither model can run', () => {
    const none: ImageModelState = { download: 'absent', failed: false }
    const page = render(three, { states: { klein: none, 'z-image-turbo': none } })
    expect(page.text()).toContain("Images can't be made yet. Setup says what is missing.")
    expect(page.button('Open Setup').getAttribute('href')).toContain('setup')
    expect(page.text()).not.toContain('Make 4 takes each')
  })
  describe('focus after Stop all', () => {
    const running = { lighthouse: { takes: 2, left: 16, failed: 0, stopped: 0 } }
    const batch: ImagesBatch = {
      total: 2,
      images: ['lighthouse'],
      failedBefore: {},
      stoppedBefore: {},
      running: false,
    }
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
    // The query client tells the page about a mutation a moment after it changes.
    const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 10))))
    const finish = (page: ReturnType<typeof render>) =>
      act(async () => {
        page.client.setQueryData(['image-making'], {})
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

    it('keeps focus on a greyed Stop all while stopping, then moves it to Close', async () => {
      const page = render(three, { batch, making: running })
      page.button('Stop all').focus()
      const answered = globalThis.fetch
      let release = () => {}
      globalThis.fetch = ((url: string, init?: RequestInit) =>
        new Promise((resolve) => {
          release = () => resolve(answered(url, init))
        })) as unknown as typeof fetch
      await act(async () => {
        page.button('Stop all').click()
      })
      await settle()
      expect(page.button('Stop all').getAttribute('aria-disabled')).toBe('true')
      expect(page.button('Stop all').textContent).toBe('Stop all')
      expect(document.activeElement).toBe(page.button('Stop all'))
      await act(async () => release())
      await finish(page)
      expect(focused.at(-1)).toBe(page.button('Close'))
      await page.press('Close')
      expect(document.activeElement).toBe(page.button('Make 4 takes each'))
    })

    it('goes to the panel button when there is no summary to show', async () => {
      const page = render(three, { making: running })
      page.button('Stop all').focus()
      await page.press('Stop all')
      await finish(page)
      expect(focused.at(-1)).toBe(page.button('Make 4 takes each'))
    })

    it('moves focus when the takes finish on their own only if it was on Stop all', async () => {
      const on = render(three, { batch, making: running })
      on.button('Stop all').focus()
      await finish(on)
      expect(focused.at(-1)).toBe(on.button('Close'))
      const elsewhere = render(three, { batch, making: running })
      const other = document.createElement('input')
      document.body.append(other)
      other.focus()
      focused.length = 0
      await finish(elsewhere)
      expect(focused).toEqual([])
      expect(document.activeElement).toBe(other)
    })

    it('says when stopping failed, keeps Stop all and its focus, and clears the line on the next press and when the takes finish', async () => {
      const page = render(three, { batch, making: running, stopFails: true })
      page.button('Stop all').focus()
      await page.press('Stop all')
      await settle()
      const words = 'The takes could not be stopped. They are still being made; try again.'
      expect(page.text()).toContain(words)
      expect(document.activeElement).toBe(page.button('Stop all'))
      const failing = globalThis.fetch
      let fail = () => {}
      globalThis.fetch = ((url: string, init?: RequestInit) =>
        new Promise((resolve) => {
          fail = () => resolve(failing(url, init))
        })) as unknown as typeof fetch
      await page.press('Stop all')
      await settle()
      expect(page.text()).not.toContain(words)
      await act(async () => fail())
      await settle()
      expect(page.text()).toContain(words)
      await finish(page)
      expect(page.text()).not.toContain(words)
    })
  })
})
