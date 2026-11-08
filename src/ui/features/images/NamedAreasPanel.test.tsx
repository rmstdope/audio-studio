import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { AreaRow, ImageRow } from '../../../core/images'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { NamedAreasPanel } = await import('./NamedAreasPanel')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((c) => c()))
afterAll(() => GlobalRegistrator.unregister())

const area = (id: string, over: Partial<AreaRow> = {}): AreaRow => ({
  id,
  title: `Title of ${id}`,
  placed: false,
  box: null,
  ...over,
})

/** Renders the panel for an image with these areas. */
async function render(areas: AreaRow[]) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(createElement(NamedAreasPanel, { row: { id: 'inn', areas } as ImageRow }))
  })
  cleanups.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  return host
}

const rows = (host: HTMLElement) => [...host.querySelectorAll('.named-area')]

describe('the named areas panel', () => {
  it('shows nothing when the game names no area', async () => {
    expect((await render([])).innerHTML).toBe('')
  })
  it('opens with its heading, the count and the line, then a row per area in order', async () => {
    const host = await render([area('b'), area('a')])
    expect(host.querySelector('h2')!.textContent).toBe('Named areas')
    expect(host.querySelector('.named-areas-head')!.textContent).toBe('Named areas0 of 2 placed')
    expect(host.querySelector('p')!.textContent).toBe(
      'The parts of this picture the game names, so that a player can click them.',
    )
    expect(rows(host).map((r) => r.querySelector('b')!.textContent)).toEqual([
      'Title of b',
      'Title of a',
    ])
    expect(rows(host)[0]!.querySelector('.mono')!.textContent).toBe('b')
  })
  it('marks an area placed or to place, and counts the placed ones', async () => {
    const host = await render([area('a', { placed: true }), area('b'), area('c')])
    expect(rows(host).map((r) => r.querySelector('.chip')!.textContent)).toEqual([
      'Placed',
      'To place',
      'To place',
    ])
    expect(rows(host)[0]!.querySelector('.chip-ok')).not.toBeNull()
    expect(rows(host)[1]!.querySelector('.chip-attention')).not.toBeNull()
    expect(host.querySelector('.named-areas-head')!.textContent).toContain('1 of 3 placed')
  })
  it('shows two areas with one title, told apart by their ids', async () => {
    const host = await render([area('a', { title: 'Door' }), area('b', { title: 'Door' })])
    expect(rows(host).map((r) => r.querySelector('.mono')!.textContent)).toEqual(['a', 'b'])
  })
  it('is read only: nothing in it can be pressed or tabbed to', async () => {
    const host = await render([area('a'), area('b')])
    expect(host.querySelectorAll('button, a, input, textarea, select, [tabindex]').length).toBe(0)
  })
})
