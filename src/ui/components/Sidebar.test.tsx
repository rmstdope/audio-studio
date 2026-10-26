import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ProjectSummary } from '../../core/summary'
import type { Route } from '../route'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { Sidebar } = await import('./Sidebar')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

const part = (id: string, title: string, dialog: string, lineCount: number) => ({
  id,
  title,
  dialogPath: '',
  dialog,
  recorded: null,
  lineCount,
  characters: [],
})

const summary = {
  name: 'Sample',
  root: '/x/sample',
  partLabel: 'Act',
  characters: [],
  parts: [
    part('act1', 'Act I: The Lantern', 'ok', 12),
    part('act2', 'Act II: The Long Name That Goes On', 'missing', 0),
    part('act3', 'Prologue', 'gone', 0),
    part('act4', 'Act IV: Broken', 'invalid', 0),
  ],
  music: {
    lists: [
      { id: 'act1', kind: 'act', title: 'Act I: The Lantern', state: 'ok', tracks: [1, 2, 3] },
      { id: 'stingers', kind: 'stingers', title: 'Stingers', state: 'ok', tracks: [1] },
    ],
  },
} as unknown as ProjectSummary

/** The sidebar's links as `[text, href, current]`, in reading order. */
function render(route: Route) {
  const container = document.createElement('div')
  document.body.append(container)
  act(() =>
    createRoot(container).render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(Sidebar, { summary, route, activePart: 'act1' }),
      ),
    ),
  )
  return {
    container,
    links: [...container.querySelectorAll('a.nav-item')].map((a) => ({
      text: [...a.childNodes]
        .map((n) => n.textContent)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
      href: a.getAttribute('href')!,
      current: a.getAttribute('aria-current') === 'page',
      title: a.getAttribute('title'),
    })),
  }
}

describe('the sidebar on a Narration page', () => {
  const { container, links } = render({ view: 'part', part: 'act1', language: 'sv' })
  const texts = links.map((l) => l.text)

  it('lists the acts under Narration and folds Music', () => {
    expect(texts.slice(0, 6)).toEqual([
      'Narration',
      'Act I 12',
      'Act II no script',
      'Prologue dialog gone',
      'Act IV invalid',
      'Music',
    ])
    expect(texts).not.toContain('Stingers')
  })
  it('highlights only the open act, which keeps the language', () => {
    expect(links.filter((l) => l.current).map((l) => l.text)).toEqual(['Act I 12'])
    expect(links[1]!.href).toBe('#/parts/act1?language=sv')
  })
  it('gives each act its whole title on pointing, and no separate Acts list', () => {
    expect(links[2]!.title).toBe('Act II: The Long Name That Goes On')
    expect(container.textContent).not.toContain('lines')
    expect(container.querySelector('nav[aria-label="Acts"]')).toBeNull()
  })
})

describe('the sidebar elsewhere', () => {
  it('lists Music, its acts and Stingers on a Music page, and folds Narration', () => {
    const texts = render({ view: 'music', page: 'stingers' }).links.map((l) => l.text)
    expect(texts.slice(0, 4)).toEqual(['Narration', 'Music', 'Act I 3', 'Stingers 1'])
    expect(texts).not.toContain('Act II no script')
  })
  it('folds both on Setup', () => {
    const { links } = render({ view: 'setup' })
    expect(links.map((l) => l.text).slice(0, 2)).toEqual(['Narration', 'Music'])
    expect(links.some((l) => l.text.startsWith('Act'))).toBe(false)
  })
})
