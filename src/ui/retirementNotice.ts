import type { Take } from '../core/retirement'

/**
 * Where the s1 notice is: the banner, the question before switching, saving, done, failed, or
 * gone (dismissed). The takes are those the question was opened with, so the words after a
 * switch stay right when the project no longer names s1.
 */
export type NoticeState =
  | { phase: 'banner' }
  | { phase: 'question'; takes: Take[] }
  | { phase: 'saving'; takes: Take[] }
  | { phase: 'done'; takes: Take[] }
  | { phase: 'failed'; takes: Take[]; reason: string }
  | { phase: 'gone' }

/** What happens to the notice. */
export type NoticeAction =
  | { type: 'ask'; takes: Take[] }
  | { type: 'keep' }
  | { type: 'save' }
  | { type: 'saved' }
  | { type: 'failed'; reason: string }
  | { type: 'dismiss' }

/** The notice as the page opens: the banner. */
export const startNotice: NoticeState = { phase: 'banner' }

/** The notice after `action`; one that does not fit the phase changes nothing. */
export function noticeReducer(state: NoticeState, action: NoticeAction): NoticeState {
  switch (action.type) {
    case 'ask':
      return state.phase === 'banner' ? { phase: 'question', takes: action.takes } : state
    case 'keep':
      return state.phase === 'question' || state.phase === 'failed' ? startNotice : state
    case 'save':
      return state.phase === 'question' || state.phase === 'failed'
        ? { phase: 'saving', takes: state.takes }
        : state
    case 'saved':
      return state.phase === 'saving' ? { phase: 'done', takes: state.takes } : state
    case 'failed':
      return state.phase === 'saving'
        ? { phase: 'failed', takes: state.takes, reason: action.reason }
        : state
    case 'dismiss':
      return state.phase === 'done' ? { phase: 'gone' } : state
  }
}
