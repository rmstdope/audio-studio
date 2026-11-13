import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Problem } from '../../core/project'

GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { ProblemScope, useBannerProblems } = await import('./ProblemScope')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => GlobalRegistrator.unregister())

const cast: Problem = { file: 'cast.json', path: 'speakers', message: 'is wrong' }
const notes: Problem = { file: 'notes.json', path: '', message: 'is not JSON' }

/** A banner that prints what it was left with. */
function Banner({ id, problems }: { id: string; problems: Problem[] }) {
  const own = useBannerProblems(id, problems)
  return createElement('p', { id }, own.map((p) => p.message).join('|'))
}

async function render(node: ReturnType<typeof createElement>) {
  const container = document.createElement('div')
  const page = createRoot(container)
  await act(() => page.render(node))
  return { container, page }
}

describe('the banners of a page', () => {
  it('leave out what a banner before them shows', async () => {
    const { container, page } = await render(
      createElement(
        ProblemScope,
        null,
        createElement(Banner, { id: 'project', problems: [cast] }),
        createElement(Banner, { id: 'part', problems: [cast, notes] }),
        createElement(Banner, { id: 'generation', problems: [cast, notes] }),
      ),
    )
    const text = (id: string) => container.querySelector(`#${id}`)!.textContent
    expect([text('project'), text('part'), text('generation')]).toEqual([
      'is wrong',
      'is not JSON',
      '',
    ])
    await act(() => page.unmount())
  })

  it('stop hiding a problem once the banner that showed it is gone', async () => {
    const both = (withProject: boolean) =>
      createElement(
        ProblemScope,
        null,
        withProject ? createElement(Banner, { id: 'project', problems: [cast] }) : null,
        createElement(Banner, { id: 'part', problems: [cast] }),
      )
    const { container, page } = await render(both(true))
    expect(container.querySelector('#part')!.textContent).toBe('')
    await act(() => page.render(both(false)))
    expect(container.querySelector('#part')!.textContent).toBe('is wrong')
    await act(() => page.unmount())
  })

  it('keep their order when one page is swapped for another that uses the same banners', async () => {
    const overview = createElement(Banner, { id: 'part', problems: [cast] })
    const lines = [
      createElement(Banner, { key: 'p', id: 'part', problems: [cast] }),
      createElement(Banner, { key: 'g', id: 'generation', problems: [cast] }),
    ]
    const { container, page } = await render(
      createElement(ProblemScope, null, createElement('div', { key: 'overview' }, overview)),
    )
    await act(() =>
      page.render(
        createElement(ProblemScope, null, createElement('section', { key: 'lines' }, lines)),
      ),
    )
    expect(container.querySelector('#part')!.textContent).toBe('is wrong')
    expect(container.querySelector('#generation')!.textContent).toBe('')
    await act(() => page.unmount())
  })

  it('show everything outside a scope', async () => {
    const { container, page } = await render(
      createElement(Banner, { id: 'part', problems: [cast] }),
    )
    expect(container.querySelector('#part')!.textContent).toBe('is wrong')
    await act(() => page.unmount())
  })
})
