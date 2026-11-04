import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ProjectSummary } from '../core/summary'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { App } = await import('./App')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const realFetch = globalThis.fetch
const cleanups: (() => void)[] = []
afterEach(() => {
  globalThis.fetch = realFetch
  cleanups.splice(0).forEach((c) => c())
})
afterAll(() => GlobalRegistrator.unregister())

const summary = {
  name: 'Sample',
  root: '/x/sample',
  projectFile: '/x/sample/content-studio.json',
  partLabel: 'Act',
  characters: [],
  problems: [],
  models: { draft: 's2.1-pro', final: 's2.1-pro' },
  parts: [
    {
      id: 'act1',
      title: 'Act I',
      dialogPath: '',
      dialog: 'ok',
      recorded: null,
      lineCount: 1,
      characters: [],
    },
  ],
  music: { lists: [] },
  images: { acts: [] },
  effects: { status: 'ok', done: { done: 0, total: 0, needs: [] } },
} as unknown as ProjectSummary

/** Renders the studio on `hash`, with `loaded` as the project already read; every request fails. */
async function render(hash: string, loaded: unknown) {
  window.location.hash = hash
  globalThis.fetch = (() =>
    Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['project'], loaded)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => act(() => root.unmount()))
  act(() => root.render(createElement(QueryClientProvider, { client }, createElement(App))))
  await settle()
  return { container, client }
}

/** Lets the failed requests come back and the studio draw what follows. */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 10)))

describe('a brief outage of the studio server', () => {
  it('keeps the page open when the project was already loaded and its refetch fails', async () => {
    const { container, client } = await render('#/changes', { ok: true, summary })
    expect(container.querySelector('h1')?.textContent).toBe('Changes')
    await act(() => client.refetchQueries({ queryKey: ['project'] }))
    await settle()
    expect(client.getQueryState(['project'])?.status).toBe('error')
    expect(container.textContent).not.toContain('The studio server did not answer')
    expect(container.querySelector('h1')?.textContent).toBe('Changes')
  })
})
