import { describe, expect, it } from 'bun:test'
import { noticeReducer, startNotice, type NoticeState } from './retirementNotice'

describe('noticeReducer', () => {
  it('goes from the banner to the question and back, writing nothing', () => {
    const asked = noticeReducer(startNotice, { type: 'ask', takes: ['draft'] })
    expect(asked).toEqual({ phase: 'question', takes: ['draft'] })
    expect(noticeReducer(asked, { type: 'keep' })).toEqual(startNotice)
  })

  it('saves, then confirms with the takes that were asked about', () => {
    let state: NoticeState = noticeReducer(startNotice, { type: 'ask', takes: ['draft', 'final'] })
    state = noticeReducer(state, { type: 'save' })
    expect(state.phase).toBe('saving')
    state = noticeReducer(state, { type: 'saved' })
    expect(state).toEqual({ phase: 'done', takes: ['draft', 'final'] })
    expect(noticeReducer(state, { type: 'dismiss' })).toEqual({ phase: 'gone' })
  })

  it('fails with the reason, and can try again or keep s1', () => {
    let state: NoticeState = noticeReducer(startNotice, { type: 'ask', takes: ['final'] })
    state = noticeReducer(noticeReducer(state, { type: 'save' }), {
      type: 'failed',
      reason: 'busy',
    })
    expect(state).toEqual({ phase: 'failed', takes: ['final'], reason: 'busy' })
    expect(noticeReducer(state, { type: 'save' })).toEqual({ phase: 'saving', takes: ['final'] })
    expect(noticeReducer(state, { type: 'keep' })).toEqual(startNotice)
  })

  it('ignores actions that do not fit the phase', () => {
    expect(noticeReducer(startNotice, { type: 'saved' })).toBe(startNotice)
    expect(noticeReducer(startNotice, { type: 'save' })).toBe(startNotice)
  })
})
