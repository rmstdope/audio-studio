import { describe, expect, it } from 'bun:test'
import { dialogDiff } from './dialogDiff'

const line = (key: string, text = 'Hi.') => ({ key, speaker: 'mira', text })

describe('dialogDiff', () => {
  it('lists the lines added and removed, by key, in dialog order', () => {
    expect(
      dialogDiff([line('a'), line('b'), line('c')], [line('a'), line('d'), line('c'), line('e')]),
    ).toEqual({
      added: ['d', 'e'],
      removed: ['b'],
      changed: [],
    })
  })

  it('lists a line whose speaker or text changed under the same key', () => {
    expect(dialogDiff([line('a', 'Hi.')], [line('a', 'Hello.')])).toEqual({
      added: [],
      removed: [],
      changed: ['a'],
    })
  })

  it('sees nothing in an unchanged dialog', () => {
    expect(dialogDiff([line('a')], [line('a')])).toEqual({ added: [], removed: [], changed: [] })
  })
})
