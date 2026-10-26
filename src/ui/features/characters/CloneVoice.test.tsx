import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { CloneVoice } = await import('./CloneVoice')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

/** Lets React and the files being read settle. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))

/** Renders the clone form of a character, opened, with `names` chosen as recordings. */
async function cloneForm(names: string[]) {
  globalThis.fetch = (async () =>
    Response.json({ ok: true, checks: [] })) as unknown as typeof fetch
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const client = new QueryClient()
  await act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(CloneVoice, {
          characterId: 'ada',
          name: 'Ada',
          currentTitle: null,
          parts: [],
          inProgress: null,
          sessionKnown: true,
          playing: null,
          toggle: () => {},
        }),
      ),
    ),
  )
  await act(() => container.querySelector<HTMLButtonElement>('#clone-voice-open')!.click())
  const picker = container.querySelector<HTMLInputElement>('input[type=file]')!
  Object.defineProperty(picker, 'files', {
    configurable: true,
    value: names.map((n) => new File(['x'], n, { type: 'audio/wav' })),
  })
  await act(() => picker.dispatchEvent(new Event('change', { bubbles: true })))
  await settle()
  const form = () => container.querySelector('form.clone-form')
  const remove = (name: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="Remove ${name}"]`)
  return { container, form, remove, unmount: () => act(() => root.unmount()) }
}

describe('CloneVoice', () => {
  let page: Awaited<ReturnType<typeof cloneForm>>
  const realFetch = globalThis.fetch
  afterEach(async () => {
    globalThis.fetch = realFetch
    await page.unmount()
    document.body.innerHTML = ''
  })

  /** Clicks a recording's ✕ the way a keyboard user does: focused first. */
  const removeByKeyboard = async (name: string) => {
    const button = page.remove(name)!
    button.focus()
    await act(() => button.click())
    await settle()
  }

  it('keeps focus on the next recording when one is removed', async () => {
    page = await cloneForm(['one.wav', 'two.wav'])
    await removeByKeyboard('one.wav')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Remove two.wav')
  })

  it('keeps focus in the form when the last recording is removed, and Escape still closes it', async () => {
    page = await cloneForm(['one.wav'])
    await removeByKeyboard('one.wav')
    expect(document.activeElement?.tagName).toBe('BUTTON')
    expect(document.activeElement?.textContent).toBe('Choose files…')

    await act(() =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    )
    expect(page.form()).toBeNull()
  })
})
