import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { RetirementNotice } = await import('./RetirementNotice')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

describe('the s1 switch question', () => {
  it('sets the model names and the file name in the mono face', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    act(() =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          createElement(RetirementNotice, {
            takes: ['draft', 'final'],
            file: 'content-studio.json',
            now: new Date('2026-10-26T00:00:00Z'),
            onNotNow: () => {},
          }),
        ),
      ),
    )
    act(() => {
      container.querySelector<HTMLButtonElement>('.notice-actions .btn-primary')!.click()
    })
    const mono = [...container.querySelectorAll('.confirm-effects .mono')].map((e) => e.textContent)
    expect(mono).toEqual(['s1', 's2.1-pro', 's1', 's2.1-pro', 'content-studio.json', 's1'])
    act(() => root.unmount())
  })
})
