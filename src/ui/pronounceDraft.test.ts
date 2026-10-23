import { describe, expect, it } from 'bun:test'
import { addRow, editRow, moveRow, removeRow, startDraft, tableOf } from './pronounceDraft'

describe('pronunciation drafts', () => {
  const table: [string, string][] = [
    ['Act I:', 'Act One:'],
    ['Eldoria', 'El-door-ia'],
  ]

  it('remembers the table it started from, whatever the page shows later', () => {
    const draft = editRow(startDraft(table), 1, 1, 'El-dor-ee-a')
    expect(draft.base).toEqual(table)
    expect(tableOf(draft)).toEqual([
      ['Act I:', 'Act One:'],
      ['Eldoria', 'El-dor-ee-a'],
    ])
  })

  it('keeps each row’s id when rows move, are added or removed', () => {
    const start = startDraft(table)
    const first = start.rows[0]!.id
    const second = start.rows[1]!.id
    const moved = moveRow(start, 1, -1)
    expect(moved.rows.map((r) => r.id)).toEqual([second, first])
    const added = addRow(moved)
    expect(added.rows).toHaveLength(3)
    expect(new Set(added.rows.map((r) => r.id)).size).toBe(3)
    expect(removeRow(added, 0).rows.map((r) => r.id)).toEqual([first, added.rows[2]!.id])
    expect(tableOf(removeRow(added, 0))).toEqual([
      ['Act I:', 'Act One:'],
      ['', ''],
    ])
  })
})
