import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ImagePatchesView, Patch } from '../../../core/imagePatches'

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
  patches: [],
  making: null,
  failed: null,
  folder: 'content-studio/cache/image-patches/inn',
  ...over,
})

/** Renders the section over a server answering `answer`; gives its element and the requests sent. */
async function render(answer: ImagePatchesView) {
  const posts: unknown[] = []
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)))
      return Response.json({ ok: true })
    }
    return Response.json(answer)
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

describe('PatchesSection', () => {
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
