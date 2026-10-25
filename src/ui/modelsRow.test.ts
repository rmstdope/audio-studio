import { describe, expect, it } from 'bun:test'
import { focusAfter, rowReducer, startRow, type RowState } from './modelsRow'

const ask = { kind: 'ask', lines: 3, cost: { now: 0, later: null } } as const

describe('rowReducer', () => {
  it('saves a choice with nothing at stake at once, and is idle again once saved', () => {
    const saving = rowReducer(startRow, { type: 'pick', to: 'drama-3', change: { kind: 'save' } })
    expect(saving).toEqual({ phase: 'saving', to: 'drama-3' })
    expect(rowReducer(saving, { type: 'saved' })).toEqual(startRow)
  })

  it('does nothing for a choice that changes nothing', () => {
    expect(rowReducer(startRow, { type: 'pick', to: 'x', change: { kind: 'none' } })).toEqual(
      startRow,
    )
  })

  it('asks first when lines go out of date, and Keep writes nothing', () => {
    const asking = rowReducer(startRow, { type: 'pick', to: 's2.1-pro', change: ask })
    expect(asking).toEqual({ phase: 'asking', to: 's2.1-pro' })
    expect(rowReducer(asking, { type: 'keep' })).toEqual(startRow)
  })

  it('switches after confirming, and fails with the reason', () => {
    let state: RowState = rowReducer(startRow, { type: 'pick', to: 's2.1-pro', change: ask })
    state = rowReducer(state, { type: 'confirm' })
    expect(state).toEqual({ phase: 'switching', to: 's2.1-pro' })
    state = rowReducer(state, { type: 'failed', reason: 'disk full' })
    expect(state).toEqual({ phase: 'failed', to: 's2.1-pro', reason: 'disk full', asked: true })
    expect(rowReducer(state, { type: 'retry' })).toEqual({ phase: 'switching', to: 's2.1-pro' })
    expect(rowReducer(state, { type: 'keep' })).toEqual(startRow)
  })

  it('retries a failed save with nothing at stake as a plain save', () => {
    let state: RowState = rowReducer(startRow, {
      type: 'pick',
      to: 'drama-3',
      change: { kind: 'save' },
    })
    state = rowReducer(state, { type: 'failed', reason: 'busy' })
    expect(state).toMatchObject({ phase: 'failed', asked: false })
    expect(rowReducer(state, { type: 'retry' })).toEqual({ phase: 'saving', to: 'drama-3' })
  })

  it('ignores a pick while something is in progress', () => {
    const saving: RowState = { phase: 'saving', to: 'a' }
    expect(rowReducer(saving, { type: 'pick', to: 'b', change: { kind: 'save' } })).toBe(saving)
  })
})

describe('focusAfter', () => {
  it('moves focus to Switch when the question opens', () => {
    expect(focusAfter({ phase: 'idle' }, { phase: 'asking', to: 'a' })).toBe('confirm')
  })
  it('returns it to the menu on Keep, and after a switch', () => {
    expect(focusAfter({ phase: 'asking', to: 'a' }, { phase: 'idle' })).toBe('menu')
    expect(focusAfter({ phase: 'switching', to: 'a' }, { phase: 'idle' })).toBe('menu')
  })
  it('returns it to the menu after a save with nothing at stake: the menu was disabled meanwhile', () => {
    expect(focusAfter({ phase: 'saving', to: 'a' }, { phase: 'idle' })).toBe('menu')
  })
  it('puts it on Try again when the save failed, and keeps it there on a retry', () => {
    const failed: RowState = { phase: 'failed', to: 'a', reason: 'r', asked: true }
    expect(focusAfter({ phase: 'switching', to: 'a' }, failed)).toBe('retry')
    expect(focusAfter(failed, { phase: 'switching', to: 'a' })).toBeNull()
  })
  it('leaves focus alone otherwise', () => {
    expect(focusAfter({ phase: 'idle' }, { phase: 'saving', to: 'a' })).toBeNull()
  })
})
