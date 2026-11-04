import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { fakeHistory, type FakeHistory } from '../../test/fakeHistory'
import type { Leaving } from './sceneDraft'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { useRoute, routeHref } = await import('./route')
const { useLeaveGuard } = await import('./sceneDraft')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((c) => c()))
afterAll(() => GlobalRegistrator.unregister())

const music = '#/music'
const store = '#/scenes/parts/act1?scene=act1-store'
const forest = '#/scenes/parts/act1?scene=act1-forest'

/** Lets the browser's queued Back, and the hashchange it fires, land. */
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 5)))

/**
 * The app's router with a page guarding its unsaved changes, as on the Scenes page: the user went
 * from Music to the store scene and changed something there. `asked` is every question put to the
 * user; the route shown is the page's text.
 */
async function dirtyStore() {
  const history: FakeHistory = fakeHistory(music)
  const asked: Leaving[] = []
  let dirty = false
  const Page = () => {
    const route = useRoute()
    useLeaveGuard(dirty, (leaving) => asked.push(leaving))
    return createElement('p', null, routeHref(route))
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    history.restore()
    window.history.replaceState(null, '', '#')
  })
  act(() => root.render(createElement(Page)))
  act(() => history.click(store))
  dirty = true
  act(() => root.render(createElement(Page)))
  return { history, asked, shown: () => container.textContent }
}

describe('Back after cancelling a move away from unsaved changes', () => {
  it('asks at once after a cancelled click on another scene, and Don’t save goes back', async () => {
    const { history, asked, shown } = await dirtyStore()
    act(() => history.click(forest))
    await settle()
    expect(asked.length).toBe(1)
    expect(window.location.hash).toBe(store)
    // Cancel: nothing is done with the question.
    history.back()
    await settle()
    expect(asked.length).toBe(2)
    act(() => asked[1]!.proceed())
    await settle()
    expect(window.location.hash).toBe(music)
    expect(shown()).toBe(music)
  })

  it('asks at once after a cancelled Back, and Don’t save lands on the page behind', async () => {
    const { history, asked, shown } = await dirtyStore()
    history.back()
    await settle()
    expect(asked.length).toBe(1)
    expect(window.location.hash).toBe(store)
    history.back()
    await settle()
    expect(asked.length).toBe(2)
    act(() => asked[1]!.proceed())
    await settle()
    expect(window.location.hash).toBe(music)
    expect(shown()).toBe(music)
    expect(history.hashes()).toEqual([music, store])
  })
})
