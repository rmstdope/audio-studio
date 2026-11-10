import { describe, expect, it } from 'bun:test'
import {
  ARROW_STEP,
  boxFromDrag,
  centred,
  isCentred,
  keepPoint,
  moveBox,
  movePoint,
  nudgeBox,
  nudgePoint,
  pointOf,
  pointOnPicture,
  resizeBox,
  smallestAt,
} from './imageAreaBox'

const size = { width: 320, height: 200 }
const box = { x: 100, y: 50, width: 60, height: 40 }

describe('pointOnPicture', () => {
  it('maps the screen to the image’s pixels and stops at the edges', () => {
    const rect = { left: 10, top: 20, width: 640, height: 400 }
    expect(pointOnPicture({ x: 330, y: 220 }, rect, size)).toEqual({ x: 160, y: 100 })
    expect(pointOnPicture({ x: -50, y: 9999 }, rect, size)).toEqual({ x: 0, y: 200 })
  })
})

describe('boxFromDrag', () => {
  it('is the box between the two points whichever way it is dragged', () => {
    expect(boxFromDrag({ x: 30, y: 40 }, { x: 10, y: 10 })).toEqual({
      x: 10,
      y: 10,
      width: 20,
      height: 30,
    })
  })
  it('is null for a click or a drag too small to be a box', () => {
    expect(boxFromDrag({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull()
    expect(boxFromDrag({ x: 5, y: 5 }, { x: 8, y: 50 })).toBeNull()
    expect(boxFromDrag({ x: 5, y: 5 }, { x: 9, y: 9 })).not.toBeNull()
  })
})

describe('moveBox', () => {
  it('moves by the distance and stops at every edge', () => {
    expect(moveBox(box, 10, -5, size)).toEqual({ ...box, x: 110, y: 45 })
    expect(moveBox(box, -500, -500, size)).toEqual({ ...box, x: 0, y: 0 })
    expect(moveBox(box, 500, 500, size)).toEqual({ ...box, x: 260, y: 160 })
  })
})

describe('resizeBox', () => {
  it('moves the edges a handle holds to the pointer', () => {
    expect(resizeBox(box, 'se', { x: 200, y: 120 })).toEqual({
      x: 100,
      y: 50,
      width: 100,
      height: 70,
    })
    expect(resizeBox(box, 'nw', { x: 90, y: 40 })).toEqual({ x: 90, y: 40, width: 70, height: 50 })
    expect(resizeBox(box, 'e', { x: 180, y: 999 })).toEqual({ ...box, width: 80 })
    expect(resizeBox(box, 'n', { x: 0, y: 30 })).toEqual({ ...box, y: 30, height: 60 })
    expect(resizeBox(box, 'sw', { x: 80, y: 100 })).toEqual({ x: 80, y: 50, width: 80, height: 50 })
    expect(resizeBox(box, 'w', { x: 120, y: 0 })).toEqual({ ...box, x: 120, width: 40 })
    expect(resizeBox(box, 's', { x: 0, y: 70 })).toEqual({ ...box, height: 20 })
    expect(resizeBox(box, 'ne', { x: 170, y: 60 })).toEqual({
      x: 100,
      y: 60,
      width: 70,
      height: 30,
    })
  })
  it('keeps the smallest size instead of turning over', () => {
    expect(resizeBox(box, 'e', { x: 50, y: 0 })).toEqual({ ...box, width: 4 })
    expect(resizeBox(box, 'w', { x: 300, y: 0 })).toEqual({ ...box, x: 156, width: 4 })
    expect(resizeBox(box, 's', { x: 0, y: 10 })).toEqual({ ...box, height: 4 })
    expect(resizeBox(box, 'n', { x: 0, y: 190 })).toEqual({ ...box, y: 86, height: 4 })
  })
})

describe('nudgeBox', () => {
  it('moves by a fixed step with the arrow keys, stopping at the edges', () => {
    expect(nudgeBox(box, 'ArrowRight', false, size)).toEqual({ ...box, x: 100 + ARROW_STEP })
    expect(nudgeBox(box, 'ArrowUp', false, size)).toEqual({ ...box, y: 50 - ARROW_STEP })
    expect(nudgeBox({ ...box, x: 1 }, 'ArrowLeft', false, size)).toEqual({ ...box, x: 0 })
    expect(nudgeBox({ ...box, y: 160 }, 'ArrowDown', false, size)).toEqual({ ...box, y: 160 })
  })
  it('resizes by the right and bottom edges with Shift, within the picture and the smallest size', () => {
    expect(nudgeBox(box, 'ArrowRight', true, size)).toEqual({ ...box, width: 60 + ARROW_STEP })
    expect(nudgeBox(box, 'ArrowDown', true, size)).toEqual({ ...box, height: 40 + ARROW_STEP })
    expect(nudgeBox({ ...box, width: 4 }, 'ArrowLeft', true, size)).toEqual({ ...box, width: 4 })
    expect(nudgeBox({ ...box, height: 5 }, 'ArrowUp', true, size)).toEqual({ ...box, height: 4 })
    expect(nudgeBox({ ...box, x: 300, width: 20 }, 'ArrowRight', true, size)).toEqual({
      ...box,
      x: 300,
      width: 20,
    })
  })
  it('is null for another key', () => {
    expect(nudgeBox(box, 'a', false, size)).toBeNull()
  })
})

describe('smallestAt', () => {
  const boxes = [
    { id: 'big', box: { x: 0, y: 0, width: 200, height: 100 } },
    { id: 'small', box: { x: 10, y: 10, width: 20, height: 20 } },
    { id: 'far', box: { x: 250, y: 150, width: 50, height: 40 } },
  ]
  it('finds the smallest box under the point, or none', () => {
    expect(smallestAt(boxes, { x: 15, y: 15 })).toBe('small')
    expect(smallestAt(boxes, { x: 100, y: 50 })).toBe('big')
    expect(smallestAt(boxes, { x: 260, y: 160 })).toBe('far')
    expect(smallestAt(boxes, { x: 230, y: 140 })).toBeNull()
  })
})

describe('the point of a box', () => {
  it('is the centre until it is moved', () => {
    expect(pointOf(box)).toEqual({ x: 130, y: 70 })
    expect(isCentred(box)).toBe(true)
    expect(isCentred({ ...box, point: { x: 131, y: 70 } })).toBe(false)
  })
  it('moves with the pointer but stops at the box’s edges', () => {
    expect(movePoint(box, { x: 110, y: 55 }).point).toEqual({ x: 110, y: 55 })
    expect(movePoint(box, { x: 0, y: 999 }).point).toEqual({ x: 100, y: 90 })
  })
  it('is not kept when dropped on the centre', () => {
    expect(movePoint({ ...box, point: { x: 101, y: 51 } }, { x: 130, y: 70 })).toEqual(box)
  })
  it('steps by the arrow step with Alt and stops at the edges', () => {
    expect(nudgePoint(box, 'ArrowRight')?.point).toEqual({ x: 130 + ARROW_STEP, y: 70 })
    const edge = { ...box, point: { x: 159, y: 90 } }
    expect(nudgePoint(edge, 'ArrowRight')?.point).toEqual({ x: 160, y: 90 })
    expect(nudgePoint(edge, 'ArrowDown')?.point).toEqual({ x: 159, y: 90 })
    expect(nudgePoint(box, 'a')).toBeNull()
  })
  it('goes back to the centre', () => {
    expect(centred({ ...box, point: { x: 101, y: 51 } })).toEqual(box)
  })
  it('stays on the same spot of the picture when the box changes, or is pushed to the nearest edge', () => {
    const was = { ...box, point: { x: 110, y: 60 } }
    expect(keepPoint(was, { ...box, x: 90, width: 80 }).point).toEqual({ x: 110, y: 60 })
    expect(keepPoint(was, { x: 120, y: 50, width: 40, height: 40 }).point).toEqual({
      x: 120,
      y: 60,
    })
  })
  it('leaves a never-moved point at the centre wherever the box goes', () => {
    expect(keepPoint(box, { ...box, x: 5 })).toEqual({ ...box, x: 5 })
  })
})
