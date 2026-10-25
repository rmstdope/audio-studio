import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { SpeedEditor } = await import('./BriefEditors')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

/** Renders the speed editor of a character in one language, and lets the page switch language. */
function speedPage() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const client = new QueryClient()
  const show = (language: string, label: string) =>
    act(() =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(SpeedEditor, {
            characterId: 'ada',
            speed: null,
            projectSpeed: 1,
            language,
            label,
          }),
        ),
      ),
    )
  const field = () => container.querySelector<HTMLInputElement>('#speed')!
  const type = (text: string) =>
    act(() => {
      const input = field()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  return { container, show, field, type, unmount: () => act(() => root.unmount()) }
}

describe('SpeedEditor', () => {
  let page: ReturnType<typeof speedPage>
  beforeAll(() => {
    page = speedPage()
  })
  afterAll(() => page.unmount())

  it('leaves an unsaved speed with its language when the page switches language', async () => {
    await page.show('sv', 'Speed · Svenska')
    await page.type('95')
    expect(page.field().value).toBe('95')
    expect(page.container.textContent).toContain('A speed is a number from')

    await page.show('de', 'Speed · Deutsch')
    expect(page.field().value).toBe('')
    expect(page.container.textContent).not.toContain('A speed is a number from')
  })
})
