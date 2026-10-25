import { describe, expect, it } from 'bun:test'
import { DesignsSchema, addDesigns, emptyDesigns, listDesigns, removeDesign } from './designs'

describe('designs', () => {
  it('numbers designs on from the ones made before', () => {
    const first = addDesigns(emptyDesigns('mara'), 'old woman', '2026-10-25T10:00:00Z', ['a', 'b'])
    const second = addDesigns(first, 'rougher', '2026-10-25T11:00:00Z', ['c'])
    expect(second.description).toBe('rougher')
    expect(second.made).toBe(3)
    expect(
      listDesigns(second).map((v) => [v.id, v.title, v.design?.n, v.design?.description]),
    ).toEqual([
      ['a', 'Design 1', 1, 'old woman'],
      ['b', 'Design 2', 2, 'old woman'],
      ['c', 'Design 3', 3, 'rougher'],
    ])
    expect(DesignsSchema.safeParse(second).success).toBe(true)
  })

  it('removes a design without renumbering the others', () => {
    const store = addDesigns(emptyDesigns('mara'), 'x', 't', ['a', 'b'])
    const left = removeDesign(store, 'a')
    expect(listDesigns(left).map((v) => v.id)).toEqual(['b'])
    expect(left.made).toBe(2)
    expect(addDesigns(left, 'y', 't2', ['c']).voices.c?.design?.n).toBe(3)
  })
})
