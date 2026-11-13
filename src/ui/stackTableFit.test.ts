import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { minWidthsAtPanelWidth } from '../../test/stylesheet'

GlobalRegistrator.register()
afterAll(() => GlobalRegistrator.unregister())

/** A table as its page draws it: `classes` on the table, inside the scrolling `.table-box`. */
function boxedTable(classes: string): Element {
  document.body.innerHTML = `<div class="table-box"><table class="${classes}"></table></div>`
  return document.querySelector('table')!
}

describe('a table that stacks fits its box above the stacking width (as-35pz)', () => {
  for (const classes of ['table stack-table images-table', 'table stack-table effects-table']) {
    it(`gives "${classes}" no minimum wider than its box at panel widths 701 to 810 px`, () => {
      const table = boxedTable(classes)
      for (let width = 701; width <= 810; width++) {
        // The box draws a 1 px border on each side, inside the panel's width.
        const tooWide = minWidthsAtPanelWidth(table, width).filter(
          (found) => Number(/: (\d+)px$/.exec(found)?.[1] ?? 0) > width - 2,
        )
        expect({ width, tooWide }).toEqual({ width, tooWide: [] })
      }
    })
  }

  it('leaves a table that does not stack its wide columns', () => {
    const found = minWidthsAtPanelWidth(boxedTable('table'), 760)
    expect(found.some((value) => value.endsWith(': 760px'))).toBe(true)
  })
})
