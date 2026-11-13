import { describe, expect, it } from 'bun:test'
import { elementsAbove, fillHeight, fillWindow, spaceBelow, type Node } from './fillWindow'

describe('the height a frame has to the bottom of the window', () => {
  it('is the window below where the frame starts', () => {
    expect(fillHeight(757, 200)).toBe(557)
    expect(fillHeight(900, 0)).toBe(900)
  })

  it('stops short of the space the page keeps under the frame', () => {
    expect(fillHeight(757, 200, 53)).toBe(504)
  })

  it('never goes negative, however far down the frame starts', () => {
    expect(fillHeight(500, 800)).toBe(0)
  })
})

/** A node with a parent, earlier siblings and padding and border under it. */
const node = (
  parent: Node | null,
  under: { padding?: number; border?: number } = {},
  before: Node[] = [],
): Node & { under: typeof under } => ({
  parentElement: parent,
  previousSiblings: before,
  under,
})
const styleOf = (n: Node & { under?: { padding?: number; border?: number } }) => ({
  paddingBottom: `${n.under?.padding ?? 0}px`,
  borderBottomWidth: `${n.under?.border ?? 0}px`,
})

describe('the space under a frame', () => {
  it('adds the padding and border of every box the frame sits in, so it ends inside them all', () => {
    const content = node(null, { padding: 32 })
    const panel = node(content, { padding: 20, border: 1 })
    const frame = node(panel)
    expect(spaceBelow(frame, styleOf)).toBe(53)
  })

  it('is nothing for a frame in boxes with no room under it', () => {
    expect(spaceBelow(node(node(null)), styleOf)).toBe(0)
  })
})

describe('what a frame’s place depends on', () => {
  it('is everything laid out before it, in it and in each box it sits in', () => {
    const notice = node(null)
    const head = node(null)
    const content = node(null, {}, [head])
    const panel = node(content, {}, [notice])
    const frame = node(panel)
    expect(elementsAbove(frame)).toEqual([notice, head])
  })
})

describe('filling the window from an element', () => {
  const element = (top: number) => {
    const props = new Map<string, string>()
    return {
      props,
      getBoundingClientRect: () => ({ top }),
      style: { setProperty: (k: string, v: string) => void props.set(k, v) },
    }
  }

  it('sets --fill-height from the element’s place, counting the page’s own scroll', () => {
    const el = element(150)
    fillWindow(el, { innerHeight: 757, scrollY: 40 }, 0)
    expect(el.props.get('--fill-height')).toBe('567px')
  })

  it('gives the same answer after the page scrolls', () => {
    const before = element(150)
    fillWindow(before, { innerHeight: 757, scrollY: 0 }, 53)
    const after = element(100)
    fillWindow(after, { innerHeight: 757, scrollY: 50 }, 53)
    expect(after.props.get('--fill-height')).toBe(before.props.get('--fill-height'))
  })
})
