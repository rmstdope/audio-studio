import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { SceneState } from '../../../core/planner'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { SceneBand } = await import('./SceneBand')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

/** A scene with a cue of its own, two of whose following lines are recorded. */
const scene: SceneState = {
  name: 'Gate',
  cue: '[tense]',
  cueFrom: 'own',
  sourceCue: null,
  lines: 3,
  following: 3,
  recordedFollowing: 2,
  firstFollowing: 'gate-1',
}

/** Renders the scene's band in a table, with its cue editor open. */
function openEditor() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          'table',
          null,
          createElement(
            'tbody',
            null,
            createElement(SceneBand, {
              partId: 'act1',
              band: {
                kind: 'band',
                id: 'gate-1',
                scene: 'Gate',
                title: 'Gate',
                shown: 3,
                total: 3,
              },
              scene,
              filtered: false,
              speakers: ['narrator'],
              names: null,
              columns: 5,
              playing: null,
              toggle: () => {},
            }),
          ),
        ),
      ),
    ),
  )
  act(() => container.querySelector<HTMLButtonElement>('.cue-button')!.click())
  const type = (text: string) =>
    act(() => {
      const input = container.querySelector<HTMLInputElement>('input')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  const warning = () => container.querySelector('.scene-warning')?.textContent ?? null
  return { type, warning, unmount: () => act(() => root.unmount()) }
}

describe('SceneBand', () => {
  let page: ReturnType<typeof openEditor>
  afterEach(() => page.unmount())

  it('warns about re-recording only while the draft differs from the saved cue', () => {
    page = openEditor()
    expect(page.warning()).toBeNull()
    page.type('[calm]')
    expect(page.warning()).toBe('Saving marks 2 recorded lines for re-recording.')
    page.type('[tense] ')
    expect(page.warning()).toBeNull()
  })
})
