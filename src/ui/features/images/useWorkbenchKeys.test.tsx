import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { fieldOwnsKeys, typingIn, useDocumentKeys, usePendingFocus } =
  await import('./useWorkbenchKeys')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => GlobalRegistrator.unregister())

/** An element of `tag`, with `type` for an input, inside the document. */
function made(tag: string, type?: string): HTMLElement {
  const element = document.createElement(tag)
  if (type) element.setAttribute('type', type)
  document.body.append(element)
  return element
}

describe('keys typed into a field are its own', () => {
  it('a text field, a text area and a menu own them; a box or a button leaves them to the page', () => {
    expect(fieldOwnsKeys(made('textarea'))).toBe(true)
    expect(fieldOwnsKeys(made('select'))).toBe(true)
    expect(fieldOwnsKeys(made('input', 'text'))).toBe(true)
    expect(fieldOwnsKeys(made('input'))).toBe(true)
    for (const type of ['checkbox', 'radio', 'button', 'submit', 'reset'])
      expect(fieldOwnsKeys(made('input', type))).toBe(false)
    expect(fieldOwnsKeys(made('button'))).toBe(false)
    expect(fieldOwnsKeys(null)).toBe(false)
  })

  it('typingIn also counts anything inside a field, a menu or an editable element', () => {
    expect(typingIn(made('input', 'checkbox'))).toBe(false)
    expect(typingIn(made('input', 'text'))).toBe(true)
    const menu = made('div')
    menu.setAttribute('role', 'menu')
    const item = document.createElement('span')
    menu.append(item)
    expect(typingIn(item)).toBe(true)
    expect(typingIn(made('div'))).toBe(false)
  })
})

describe('useDocumentKeys', () => {
  async function mount(active: boolean, heard: string[], label: string) {
    const Page = () => {
      const keys = useDocumentKeys(active)
      keys.current = (event) => heard.push(`${label}:${event.key}`)
      return null
    }
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(createElement(Page)))
    return root
  }
  const press = (key: string) =>
    act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key })))

  it('hears keys anywhere on the page while active, with the latest handler', async () => {
    const heard: string[] = []
    const root = await mount(true, heard, 'a')
    await press('ArrowLeft')
    await act(async () => root.unmount())
    await press('ArrowLeft')
    expect(heard).toEqual(['a:ArrowLeft'])
  })

  it('hears nothing while not active', async () => {
    const heard: string[] = []
    await mount(false, heard, 'b')
    await press('c')
    expect(heard).toEqual([])
  })
})

describe('usePendingFocus', () => {
  type Want = 'one' | 'two'
  async function mount(elements: Record<Want, HTMLButtonElement | null>) {
    const seen: { focusOn: ((want: Want, quietly?: boolean) => void) | null } = { focusOn: null }
    const Page = () => {
      seen.focusOn = usePendingFocus<Want>((want) => elements[want])
      return null
    }
    await act(async () => createRoot(document.createElement('div')).render(createElement(Page)))
    return seen as { focusOn: (want: Want, quietly?: boolean) => void }
  }

  it('focuses the asked-for element once the render has settled, and only once', async () => {
    const one = made('button') as HTMLButtonElement
    const two = made('button') as HTMLButtonElement
    const page = await mount({ one, two })
    await act(async () => page.focusOn('two'))
    expect(document.activeElement).toBe(two)
    one.focus()
    await act(async () => void 0)
    expect(document.activeElement).toBe(one)
  })

  it('does not scroll when asked to be quiet', async () => {
    const one = made('button') as HTMLButtonElement
    const options: (FocusOptions | undefined)[] = []
    const realFocus = one.focus.bind(one)
    one.focus = (o?: FocusOptions) => (options.push(o), realFocus(o))
    const page = await mount({ one, two: null })
    await act(async () => page.focusOn('one', true))
    await act(async () => page.focusOn('one'))
    expect(options).toEqual([{ preventScroll: true }, undefined])
  })

  it('gives up when the element is not there', async () => {
    document.body.innerHTML = ''
    const page = await mount({ one: null, two: null })
    await act(async () => page.focusOn('one'))
    expect(document.activeElement).toBe(document.body)
  })
})
