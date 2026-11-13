import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { useTrackActionsState, useTrackActions } = await import('./trackActions')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => GlobalRegistrator.unregister())

describe('the track page’s last pressed action', () => {
  it('shows only the failure line of the action pressed last', async () => {
    const seen: { state: ReturnType<typeof useTrackActionsState> | null } = { state: null }
    const Page = () => {
      seen.state = useTrackActionsState()
      return null
    }
    await act(async () => createRoot(document.createElement('div')).render(createElement(Page)))
    expect(seen.state!.shows('choose:1')).toBe(false)
    await act(async () => seen.state!.press('choose:1'))
    expect(seen.state!.shows('choose:1')).toBe(true)
    await act(async () => seen.state!.press('trim:2'))
    expect(seen.state!.shows('choose:1')).toBe(false)
    expect(seen.state!.shows('trim:2')).toBe(true)
  })

  it('shows every line without a page around it', async () => {
    const seen: { actions: ReturnType<typeof useTrackActions> | null } = { actions: null }
    const Card = () => {
      seen.actions = useTrackActions()
      return null
    }
    await act(async () => createRoot(document.createElement('div')).render(createElement(Card)))
    expect(seen.actions!.shows('anything')).toBe(true)
  })
})
