import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ImagePatchesView, Patch } from '../../../core/imagePatches'
import type { ProjectFailure } from '../../../services/workspace'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { PatchesSection } = await import('./PatchesSection')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
const realFetch = globalThis.fetch
afterEach(() => {
  cleanups.splice(0).forEach((c) => c())
  globalThis.fetch = realFetch
})
afterAll(() => GlobalRegistrator.unregister())

const patch = (n: number, instruction: string): Patch => ({
  n,
  take: 3,
  seed: 1,
  instruction,
  area: { x: 10, y: 10, width: 100, height: 100 },
})

const view = (over: Partial<ImagePatchesView> = {}): ImagePatchesView => ({
  take: { n: 3, width: 1024, height: 576 },
  pictureGone: false,
  patches: [],
  making: null,
  failed: null,
  folder: 'content-studio/cache/image-patches/inn',
  ...over,
})

/**
 * Renders the section over a server answering `answer` (a function is asked at each request); gives
 * its element and the requests sent. A POST is answered `posted`.
 */
async function render(
  answer: ImagePatchesView | ProjectFailure | (() => ImagePatchesView),
  posted: { status: number; body: unknown } = { status: 200, body: { ok: true } },
) {
  const posts: unknown[] = []
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)))
      return Response.json(posted.body, { status: posted.status })
    }
    return Response.json(typeof answer === 'function' ? answer() : answer)
  }) as typeof fetch
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(PatchesSection, { imageId: 'inn' }),
      ),
    )
  })
  for (let i = 0; i < 5; i++) await act(async () => await new Promise((r) => setTimeout(r, 5)))
  cleanups.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  return { host, posts }
}

const overlay = (host: Element) => host.querySelector<HTMLImageElement>('img.patch-over')

/** Sends a pointer event of `type` at this point to `stage`. */
function pointer(stage: Element, type: string, x: number, y: number, init: PointerEventInit = {}) {
  stage.dispatchEvent(
    new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, ...init }),
  )
}

/** The picture to mark, one screen pixel per pixel of the take. */
function stageOf(host: Element): HTMLElement {
  const stage = host.querySelector<HTMLElement>('.patch-stage')!
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1024, height: 576 }) as DOMRect
  stage.setPointerCapture = () => {}
  return stage
}

/** Drags over the stage from one point to another. */
async function drag(stage: Element, from: [number, number], to: [number, number]) {
  await act(async () => pointer(stage, 'pointerdown', ...from))
  await act(async () => pointer(stage, 'pointermove', ...to))
  await act(async () => pointer(stage, 'pointerup', ...to))
}

/** Types into the instruction field. */
async function say(host: Element, text: string) {
  const field = host.querySelector('textarea')!
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  await act(async () => {
    set.call(field, text)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Lets what the page asked for arrive. */
async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => await new Promise((r) => setTimeout(r, 5)))
}

const makeButton = (host: Element) => host.querySelector<HTMLButtonElement>('button.patch-make')!

describe('PatchesSection', () => {
  it('is headed as the navigator’s own try, not the game’s patches', async () => {
    const { host } = await render(view())
    expect(host.querySelector('h2')?.textContent).toBe('Try a patch of your own')
    expect(host.textContent).toContain('An experiment: nothing here reaches the game.')
  })

  it('asks for a patch of the dragged area with the instruction as written, trimmed', async () => {
    const { host, posts } = await render(view())
    await drag(stageOf(host), [100, 50], [300, 250])
    expect(host.querySelector('.patch-mark')).not.toBeNull()
    expect(makeButton(host).disabled).toBe(true)
    await say(host, '  the door is gone ')
    expect(makeButton(host).disabled).toBe(false)
    await act(async () => makeButton(host).click())
    await settle()
    expect(posts).toEqual([
      { area: { x: 100, y: 50, width: 200, height: 200 }, instruction: 'the door is gone' },
    ])
  })

  it('does not mark with another button or a ctrl-click', async () => {
    const { host } = await render(view())
    const stage = stageOf(host)
    await drag(stage, [100, 50], [300, 250])
    await act(async () => pointer(stage, 'pointerdown', 10, 10, { button: 2 }))
    await act(async () => pointer(stage, 'pointermove', 40, 40))
    await act(async () => pointer(stage, 'pointerdown', 10, 10, { ctrlKey: true }))
    await act(async () => pointer(stage, 'pointermove', 40, 40))
    const mark = host.querySelector<HTMLElement>('.patch-mark')!
    expect(mark.style.width).toBe(`${(200 / 1024) * 100}%`)
  })

  it('stops following the pointer when the drag is cancelled', async () => {
    const { host } = await render(view())
    const stage = stageOf(host)
    await act(async () => pointer(stage, 'pointerdown', 100, 50))
    await act(async () => pointer(stage, 'pointermove', 300, 250))
    await act(async () => pointer(stage, 'pointercancel', 300, 250))
    await act(async () => pointer(stage, 'pointermove', 500, 500))
    const mark = host.querySelector<HTMLElement>('.patch-mark')!
    expect(mark.style.width).toBe(`${(200 / 1024) * 100}%`)
  })

  it('goes back to the newest patch, shown, when another is asked for', async () => {
    const { host } = await render(view({ patches: [patch(1, 'first'), patch(2, 'second')] }))
    const first = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('first'),
    )!
    await act(async () => first.click())
    await act(async () => host.querySelector<HTMLInputElement>('input.patch-switch')!.click())
    await say(host, 'again')
    await act(async () => makeButton(host).click())
    await settle()
    expect(overlay(host)?.getAttribute('src')).toBe('/api/images/inn/patches/2')
  })

  it("marks a picked try's area again, for another try on the same spot", async () => {
    const { host } = await render(view({ patches: [patch(1, 'first')] }))
    expect(host.querySelector('.patch-mark')).toBeNull()
    const first = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('first'),
    )!
    await act(async () => first.click())
    expect(host.querySelector('.patch-mark')).toBeNull()
    await act(async () => host.querySelector<HTMLInputElement>('input.patch-switch')!.click())
    expect(host.querySelector('.patch-mark')).not.toBeNull()
  })

  it('shows why a request was refused', async () => {
    const { host } = await render(view(), {
      status: 409,
      body: { ok: false, message: 'A patch of this image is being made.' },
    })
    await drag(stageOf(host), [100, 50], [300, 250])
    await say(host, 'x')
    await act(async () => makeButton(host).click())
    await settle()
    expect(host.textContent).toContain('A patch of this image is being made.')
  })

  it('shows a request that could not be sent', async () => {
    const { host } = await render(view(), { status: 500, body: {} })
    await drag(stageOf(host), [100, 50], [300, 250])
    await say(host, 'x')
    await act(async () => makeButton(host).click())
    await settle()
    expect(host.textContent).toContain('making the patch answered 500')
  })

  it('shows the finished patch without being asked, while one is being made', async () => {
    let finished = false
    const { host } = await render(() =>
      finished
        ? view({ patches: [patch(1, 'first')] })
        : view({ making: { instruction: 'first', area: patch(1, '').area } }),
    )
    expect(overlay(host)).toBeNull()
    finished = true
    await act(async () => await new Promise((r) => setTimeout(r, 1100)))
    await settle()
    expect(overlay(host)).not.toBeNull()
  })

  it("says so when the chosen take's picture is gone", async () => {
    const { host } = await render(view({ take: null, pictureGone: true }))
    expect(host.textContent).toContain('cannot be patched')
  })

  it('names a patch board that cannot be read', async () => {
    const { host } = await render({
      ok: false,
      file: 'content-studio/cache/image-patches/inn/board.json',
      problems: [],
    })
    expect(host.textContent).toContain('board.json cannot be used')
  })

  it('shows the chosen take to mark, and says where patches are saved', async () => {
    const { host } = await render(view())
    expect(host.querySelector('img.patch-take')?.getAttribute('src')).toBe(
      '/api/images/inn/takes/3',
    )
    expect(host.textContent).toContain('content-studio/cache/image-patches/inn')
    expect(overlay(host)).toBeNull()
  })

  it('cannot make a patch until an area is marked', async () => {
    const { host } = await render(view())
    expect(host.querySelector<HTMLButtonElement>('button.patch-make')?.disabled).toBe(true)
    expect(host.textContent).toContain('Drag over the picture')
  })

  it('says the marked area is kept with its colours matched to the take around it', async () => {
    const { host } = await render(view())
    expect(host.querySelector('.patches > p')?.textContent?.replace(/\s+/g, ' ')).toBe(
      'Drag over the chosen take to mark an area, then say what should change there. The whole take is edited and only the marked area is kept, with its colours matched to the take around it. An experiment: nothing here reaches the game.',
    )
  })

  it('lays the newest patch over the take, and lists every try', async () => {
    const { host } = await render(view({ patches: [patch(1, 'first'), patch(2, 'second')] }))
    expect(overlay(host)?.getAttribute('src')).toBe('/api/images/inn/patches/2')
    expect(host.textContent).toContain('first')
    expect(host.textContent).toContain('second')
  })

  it('switches the patch off and on', async () => {
    const { host } = await render(view({ patches: [patch(1, 'first')] }))
    const box = host.querySelector<HTMLInputElement>('input.patch-switch')!
    expect(box.checked).toBe(true)
    await act(async () => box.click())
    expect(overlay(host)).toBeNull()
    await act(async () => box.click())
    expect(overlay(host)).not.toBeNull()
  })

  it('shows another try when it is picked', async () => {
    const { host } = await render(view({ patches: [patch(1, 'first'), patch(2, 'second')] }))
    const first = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('first'),
    )!
    await act(async () => first.click())
    expect(overlay(host)?.getAttribute('src')).toBe('/api/images/inn/patches/1')
  })

  it('says a patch is being made, and why one failed', async () => {
    const making = await render(view({ making: { instruction: 'x', area: patch(1, '').area } }))
    expect(making.host.textContent).toContain('Making the patch')
    expect(making.host.querySelector<HTMLButtonElement>('button.patch-make')?.disabled).toBe(true)
    const failed = await render(view({ failed: { instruction: 'x', message: 'Out of memory.' } }))
    expect(failed.host.textContent).toContain('Out of memory.')
  })

  it('shows nothing when no take of the studio is there to patch', async () => {
    const { host } = await render(view({ take: null }))
    expect(host.textContent).toBe('')
  })
})
