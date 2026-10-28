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

  it('keeps the id each of ElevenLabs’ designs is saved by', () => {
    const designs = addDesigns(emptyDesigns('mara'), 'old', 't', ['d1', 'd2'], ['g1', 'g2'])
    expect(designs.voices.d2?.design).toEqual({
      n: 2,
      description: 'old',
      at: 't',
      generated: 'g2',
    })
    expect(addDesigns(emptyDesigns('mara'), 'old', 't', ['d1']).voices.d1?.design).toEqual({
      n: 1,
      description: 'old',
      at: 't',
    })
  })

  it('removes a design without renumbering the others', () => {
    const store = addDesigns(emptyDesigns('mara'), 'x', 't', ['a', 'b'])
    const left = removeDesign(store, 'a')
    expect(listDesigns(left).map((v) => v.id)).toEqual(['b'])
    expect(left.made).toBe(2)
    expect(addDesigns(left, 'y', 't2', ['c']).voices.c?.design?.n).toBe(3)
  })
})
