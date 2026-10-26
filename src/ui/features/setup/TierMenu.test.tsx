import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { TierMenu } = await import('./SetupView')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

describe('the tier menu', () => {
  it('says why the tier could not be saved, not a status code', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      Response.json(
        {
          ok: false,
          problems: [
            {
              file: 'audio-studio.json',
              path: 'narration.quality.fishTier',
              message: 'permission denied',
            },
          ],
        },
        { status: 409 },
      )) as unknown as typeof fetch
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      act(() =>
        root.render(
          createElement(
            QueryClientProvider,
            { client: new QueryClient() },
            createElement(TierMenu, { chosen: null }),
          ),
        ),
      )
      const select = container.querySelector('select')!
      await act(async () => {
        select.value = '100'
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
      for (let i = 0; i < 50 && !container.querySelector('[role="alert"]'); i++) {
        await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
      }
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        'Could not save the tier: permission denied. Your choice is not saved.',
      )
    } finally {
      act(() => root.unmount())
      globalThis.fetch = realFetch
    }
  })
})
