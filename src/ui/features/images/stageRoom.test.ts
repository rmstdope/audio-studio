import { describe, expect, it } from 'bun:test'
import { heightBesides, stageChrome, type Box } from './stageRoom'

const box = (offsetHeight: number, ...kids: Box[]): Box => {
  const me: Box = { parentElement: null, children: kids, offsetHeight }
  for (const kid of kids) kid.parentElement = me
  return me
}
const gap = () => 4

describe('what a side of the stage holds besides its picture', () => {
  it('adds the siblings on the way up from the picture, and the gaps between', () => {
    const picture = box(300)
    const side = box(500, box(20), box(0, box(18), picture), box(30))
    // 20 + 4 (first sibling), 18 + 4 (inside the middle box), 30 + 4 (last): 80
    expect(heightBesides(picture, side, gap)).toBe(80)
  })

  it('adds the padding and border of each box the picture sits inside', () => {
    const picture = box(300)
    const warn = box(0, box(18), picture)
    const side = box(500, warn)
    // 18 + 4 (sibling), and the 26 the box around them takes up besides its content
    expect(heightBesides(picture, side, gap, (b) => (b === warn ? 26 : 0))).toBe(48)
  })

  it('is the larger of the two sides’ when both show a picture', () => {
    const leftPic = box(100)
    const l = box(400, box(20), leftPic)
    const rightPic = box(100)
    const r = box(400, box(20), box(40), rightPic)
    expect(
      stageChrome(
        [
          { side: l, picture: leftPic },
          { side: r, picture: rightPic },
        ],
        gap,
      ),
    ).toBe(68)
  })

  it('uses the side that shows a picture when the other holds a question or an empty frame', () => {
    const pic = box(100)
    const r = box(400, box(20), pic)
    expect(
      stageChrome(
        [
          { side: box(400), picture: null },
          { side: r, picture: pic },
        ],
        gap,
      ),
    ).toBe(24)
  })

  it('is unknown when neither side shows a picture', () => {
    expect(stageChrome([{ side: box(400), picture: null }], gap)).toBeNull()
  })
})
