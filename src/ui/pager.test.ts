import { describe, expect, test } from 'bun:test'
import { pagerFor, pagerStep } from './pager'

const plain = (key: string, over: Partial<Parameters<typeof pagerStep>[0]> = {}) =>
  pagerStep({ key, modifier: false, target: { tagName: 'DIV', closest: () => null }, ...over })

describe('pagerStep', () => {
  test('left and right step back and forward', () => {
    expect(plain('ArrowLeft')).toBe(-1)
    expect(plain('ArrowRight')).toBe(1)
  })
  test('other keys and modified keys do nothing', () => {
    expect(plain('ArrowUp')).toBeNull()
    expect(plain('ArrowLeft', { modifier: true })).toBeNull()
  })
  test('typing in a field is the field’s', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT'])
      expect(plain('ArrowLeft', { target: { tagName, closest: () => null } })).toBeNull()
    expect(
      plain('ArrowLeft', {
        target: { tagName: 'DIV', isContentEditable: true, closest: () => null },
      }),
    ).toBeNull()
  })
  test('a control that uses the arrows keeps them', () => {
    expect(
      plain('ArrowRight', { target: { tagName: 'BUTTON', closest: () => ({}) } }),
    ).toBeNull()
  })
})

describe('pagerFor', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const step = (i: { id: string }) => ({ name: i.id.toUpperCase(), href: `#/${i.id}` })
  test('names the place and the neighbours', () => {
    expect(pagerFor(items, 'b', step)).toEqual({
      place: { position: 2, count: 3 },
      previous: { name: 'A', href: '#/a' },
      next: { name: 'C', href: '#/c' },
    })
    expect(pagerFor(items, 'a', step)?.previous).toBeNull()
  })
  test('is null for an item the list lacks', () => {
    expect(pagerFor(items, 'z', step)).toBeNull()
  })
})
