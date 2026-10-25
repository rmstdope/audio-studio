import { describe, expect, it } from 'bun:test'
import { addGroup, editGroup, groupsOf, removeGroup, startDraft } from './soundAlikeDraft'

describe('sound-alike drafts', () => {
  const groups = [
    ['Lyria', 'Liria'],
    ['Elior', 'Ilyar'],
  ]

  it('gives the same rows, ids and all, every time it is started from the same groups', () => {
    expect(startDraft(groups)).toEqual(startDraft(groups))
    expect(startDraft(groups).rows.map((r) => r.text)).toEqual(['Lyria, Liria', 'Elior, Ilyar'])
  })

  it('changes the row edited, first keystroke included, and remembers where it began', () => {
    const draft = editGroup(startDraft(groups), 0, 'Lyria, Liria, Leeria')
    expect(draft.base).toEqual(groups)
    expect(groupsOf(draft)).toEqual([
      ['Lyria', 'Liria', 'Leeria'],
      ['Elior', 'Ilyar'],
    ])
  })

  it('keeps each row’s id when rows are added or removed', () => {
    const start = startDraft(groups)
    const added = addGroup(start)
    expect(new Set(added.rows.map((r) => r.id)).size).toBe(3)
    const removed = removeGroup(added, 0)
    expect(removed.rows.map((r) => r.id)).toEqual([start.rows[1]!.id, added.rows[2]!.id])
    expect(groupsOf(removed)).toEqual([['Elior', 'Ilyar']])
  })
})
