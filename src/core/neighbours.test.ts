import { describe, expect, test } from 'bun:test'
import { neighbours } from './neighbours'

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

describe('neighbours', () => {
  test('the middle has both neighbours and its place', () => {
    expect(neighbours(items, 'b')).toEqual({
      position: 2,
      count: 3,
      previous: { id: 'a' },
      next: { id: 'c' },
    })
  })
  test('the first has no previous and the last no next; it does not wrap', () => {
    expect(neighbours(items, 'a')?.previous).toBeNull()
    expect(neighbours(items, 'c')?.next).toBeNull()
  })
  test('one item is 1 of 1 with neither', () => {
    expect(neighbours([{ id: 'x' }], 'x')).toEqual({
      position: 1,
      count: 1,
      previous: null,
      next: null,
    })
  })
  test('an id not in the list has no place', () => {
    expect(neighbours(items, 'z')).toBeNull()
  })
})
