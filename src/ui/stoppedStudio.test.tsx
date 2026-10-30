import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { PartDetail } from '../services/workspace'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { App } = await import('./App')
const { AdoptBanner } = await import('./features/overview/PartOverview')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

async function render(node: ReturnType<typeof createElement>) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'always' } },
  })
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, node))
    await new Promise((r) => setTimeout(r, 50))
  })
  for (let i = 0; i < 10 && container.textContent === 'Opening project…'; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
  return container
}

describe('the studio page', () => {
  it('names content-studio when the server does not answer', async () => {
    const down = (() => Promise.reject(new Error('down'))) as unknown as typeof fetch
    globalThis.fetch = down
    window.fetch = down
    const container = await render(createElement(App))
    expect(container.textContent).toContain('Is content-studio still running in the terminal?')
  })

  it('says clips the studio did not make were recorded outside the studio', async () => {
    const part = { id: 'act1', counts: { untracked: 2 } } as unknown as PartDetail
    const container = await render(createElement(AdoptBanner, { part }))
    expect(container.querySelector('strong')!.textContent).toBe(
      '2 clips recorded outside the studio',
    )
  })
})
