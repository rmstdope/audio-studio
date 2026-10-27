import type { Change } from '../core/models'

/**
 * Where one stage's row is: idle, saving a choice with nothing at stake, asking before a change
 * that makes lines out of date, switching once confirmed, or failed (`asked`: it had been asked).
 * While it is not idle the menu shows the old model, or is disabled.
 */
export type RowState =
  | { phase: 'idle' }
  | { phase: 'saving'; to: string }
  | { phase: 'asking'; to: string }
  | { phase: 'switching'; to: string }
  | { phase: 'failed'; to: string; reason: string; asked: boolean }

/** What happens to a row. */
export type RowAction =
  | { type: 'pick'; to: string; change: Pick<Change, 'kind'> }
  | { type: 'keep' }
  | { type: 'confirm' }
  | { type: 'retry' }
  | { type: 'saved' }
  | { type: 'failed'; reason: string }

/** The row as the page opens. */
export const startRow: RowState = { phase: 'idle' }

/** The row after `action`; one that does not fit the phase changes nothing. */
export function rowReducer(state: RowState, action: RowAction): RowState {
  switch (action.type) {
    case 'pick':
      if (state.phase !== 'idle' || action.change.kind === 'none') return state
      return action.change.kind === 'save'
        ? { phase: 'saving', to: action.to }
        : { phase: 'asking', to: action.to }
    case 'keep':
      return state.phase === 'asking' || state.phase === 'failed' ? startRow : state
    case 'confirm':
      return state.phase === 'asking' ? { phase: 'switching', to: state.to } : state
    case 'retry':
      return state.phase === 'failed'
        ? { phase: state.asked ? 'switching' : 'saving', to: state.to }
        : state
    case 'saved':
      return state.phase === 'saving' || state.phase === 'switching' ? startRow : state
    case 'failed':
      return state.phase === 'saving' || state.phase === 'switching'
        ? {
            phase: 'failed',
            to: state.to,
            reason: action.reason,
            asked: state.phase === 'switching',
          }
        : state
  }
}

/** Where focus goes when a row goes from `was` to `now`: null leaves it where it is. */
export function focusAfter(was: RowState, now: RowState): 'confirm' | 'menu' | 'retry' | null {
  if (was.phase === now.phase) return null
  if (now.phase === 'asking') return 'confirm'
  if (now.phase === 'failed') return 'retry'
  if (now.phase === 'idle') return 'menu'
  return null
}
