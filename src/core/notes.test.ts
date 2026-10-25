import { describe, expect, it } from 'bun:test'
import { NotesSchema, emptyNotes, withNote } from './notes'

describe('withNote', () => {
  it('keeps a note on a line, trimmed, replacing the one before', () => {
    const once = withNote(emptyNotes('act1'), 'k1', '  too fast ')
    const twice = withNote(once, 'k1', 'retake')
    expect(once.lines).toEqual({ k1: 'too fast' })
    expect(twice.lines).toEqual({ k1: 'retake' })
    expect(NotesSchema.parse(twice)).toEqual(twice)
  })

  it('removes a note cleared, and is unchanged when nothing changes', () => {
    const notes = withNote(emptyNotes('act1'), 'k1', 'x')
    expect(withNote(notes, 'k1', ' ').lines).toEqual({})
    expect(withNote(notes, 'k1', 'x')).toBe(notes)
    expect(withNote(notes, 'k2', '')).toBe(notes)
  })
})
