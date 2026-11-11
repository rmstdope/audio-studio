import type { Why } from './off'

/** Why a control waits while a save is under way. */
export const SAVING = 'Wait for the save to finish.'

/** Why a control waits while another change is under way. */
export const CHANGING = 'Wait for the current change to finish.'

/** Why a model row waits while another row is being saved. */
export const OTHER_ROW = 'Another model is being saved. Wait for it to finish.'

/** Why a clone control waits while the voice is being cloned. */
export const CLONING = 'Cloning is under way. Wait for it to finish.'

/** Why a Save button is off when nothing differs from what is saved. */
export const NOTHING_TO_SAVE = 'Nothing has changed yet. Change something to turn Save on.'

/** Why a Save button is off when the file changed under the edit. */
export const FILE_MOVED =
  'The file changed since you began editing. Discard your changes to see it, then make yours again.'

/**
 * The reasons a Save button is off, in the order to deal with them: a problem with the edit, the
 * file having moved, nothing to save, then a save under way. Spread into `off(...)`.
 */
export function saveReasons(s: {
  changed: boolean
  moved: boolean
  problem: string | null
  pending: boolean
}): Why[] {
  return [s.problem, s.moved && FILE_MOVED, !s.changed && NOTHING_TO_SAVE, s.pending && SAVING]
}

/**
 * The reasons Clone voice is off, in the order to deal with them: what is wrong with the files, no
 * recording to send, no name, no permission ticked, then a clone under way.
 */
export function cloneReasons(s: {
  note: string | null
  sendable: number
  name: string
  permitted: boolean
  cloning: boolean
}): Why[] {
  return [
    s.note,
    s.sendable === 0 &&
      'Choose at least one recording to send. Clone voice turns on when there is one.',
    s.name.trim() === '' && 'The voice has no name yet. Name it to turn Clone voice on.',
    !s.permitted &&
      'Tick that the recordings are yours, or that you have permission, to turn Clone voice on.',
    s.cloning && CLONING,
  ]
}
