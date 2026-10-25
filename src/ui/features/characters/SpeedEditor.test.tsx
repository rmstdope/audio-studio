import { afterAll, afterEach, describe, expect, it } from 'bun:test'
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
  const show = (language: string, label: string, speed: number | null = null) =>
    act(() =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(SpeedEditor, {
            characterId: 'ada',
            speed,
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
  const save = () =>
    act(async () => {
      container.querySelector<HTMLButtonElement>('button[type=submit]')!.click()
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  return { container, show, field, type, save, unmount: () => act(() => root.unmount()) }
}

describe('SpeedEditor', () => {
  let page: ReturnType<typeof speedPage>
  const realFetch = globalThis.fetch
  afterEach(async () => {
    globalThis.fetch = realFetch
    await page.unmount()
  })

  it('leaves an unsaved speed with its language when the page switches language', async () => {
    page = speedPage()
    await page.show('sv', 'Speed · Svenska')
    await page.type('95')
    expect(page.field().value).toBe('95')
    expect(page.container.textContent).toContain('A speed is a number from')

    await page.show('de', 'Speed · Deutsch', 1.2)
    expect(page.field().value).toBe('1.2')
    expect(page.container.textContent).not.toContain('A speed is a number from')
  })

  it('leaves a refused save with its language when the page switches language', async () => {
    globalThis.fetch = (async () =>
      Response.json(
        { ok: false, problems: [{ file: 'cast.json', path: 'ada', message: 'refused here' }] },
        { status: 409 },
      )) as unknown as typeof fetch
    page = speedPage()
    await page.show('sv', 'Speed · Svenska')
    await page.type('0.9')
    await page.save()
    expect(page.container.textContent).toContain('The speed could not be saved')

    await page.show('de', 'Speed · Deutsch')
    expect(page.container.textContent).not.toContain('The speed could not be saved')
  })
})
