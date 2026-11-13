import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { PageHeader } = await import('./PageHeader')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

type Props = Parameters<typeof PageHeader>[0]
const pager: NonNullable<Props['pager']> = {
  place: { position: 2, count: 5 },
  previous: { name: 'A', href: '#/a' },
  next: { name: 'C', href: '#/c' },
}

function show(props: Props) {
  const container = document.createElement('div')
  document.body.append(container)
  act(() => createRoot(container).render(createElement(PageHeader, props)))
  return container
}

describe('PageHeader', () => {
  it('puts the title, the tabs, then the actions and the pager at the right end', () => {
    const c = show({
      title: createElement('h1', null, 'Title'),
      tabs: createElement('nav', null, 'Tabs'),
      actions: createElement('button', { className: 'btn' }, 'Go'),
      pager,
    })
    const header = c.querySelector('header.page-header')!
    expect([...header.children].map((e) => e.tagName)).toEqual(['DIV', 'NAV', 'DIV'])
    const end = header.querySelector('.header-actions.header-end')!
    expect(end.children[0]!.textContent).toBe('Go')
    expect(end.textContent).toContain('2 of 5')
  })

  it('wraps a pager alone the same way', () => {
    const c = show({ title: createElement('h1', null, 'T'), pager })
    expect(c.querySelector('.header-actions.header-end')?.textContent).toContain('2 of 5')
  })

  it('has no right-hand group without actions or a pager', () => {
    const c = show({ title: createElement('h1', null, 'T'), pager: null })
    expect(c.querySelector('.header-end')).toBeNull()
  })
})
