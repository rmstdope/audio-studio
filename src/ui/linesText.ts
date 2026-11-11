/** Why a refresh from the game is running: the sentence the studio already uses for it. */
export function refreshRunningWhy(running: boolean): string | false {
  return running && 'Wait for the refresh from the game to finish.'
}

/** Why a line’s Record button is greyed, or false when it is on. */
export function recordingWhy(recording: boolean): string | false {
  return recording && 'This line is being recorded. Wait for the take to finish.'
}

/** Why a weak line’s Accept and Check again are greyed, or false when they are on. */
export function checkingWhy(checking: boolean): string | false {
  return checking && 'Whisper is hearing this take again. Wait for it to finish.'
}

/** Why Hear it is greyed while a try is being recorded, or false when it is on. */
export function hearWhy(pending: boolean): string | false {
  return pending && 'The cue is being tried. Wait for the take to finish.'
}

/** Why a field’s Save is greyed (its text is as it was, or it is being saved), or false. */
export function fieldSaveWhy(
  what: 'cue' | 'note',
  now: { pending: boolean; unchanged: boolean },
): string | false {
  if (now.unchanged) return `The ${what} is the same as it is now. Change it first, then save.`
  return now.pending && `The ${what} is being saved. Wait for it to finish.`
}

/** Why a cue gap’s Save or Add is greyed, or false: the line’s words, no cue, the same cue, waiting. */
export function cueGapSaveWhy(now: {
  changed: boolean
  cue: string
  placed: string | null
  pending: boolean
}): string | false {
  if (now.changed)
    return 'This line’s words changed in the game. Close this and refresh the dialog first.'
  if (!now.cue) return 'There is no cue yet. Type a cue first, then save.'
  if (now.cue === now.placed) return 'The cue is the same as it is now. Change it first, then save.'
  return now.pending && 'The cue is being saved. Wait for it to finish.'
}

/** Why a scene cue’s Hear it is greyed: no line follows it, or a try is being recorded. */
export function sceneHearWhy(now: { following: boolean; pending: boolean }): string | false {
  if (!now.following)
    return 'No line in this scene follows the cue, so there is nothing to hear it on.'
  return hearWhy(now.pending)
}

/** Why Use this take is greyed: the line changed since, or a use is under way. */
export function takeUseWhy(now: { current: boolean; pending: boolean }): string | false {
  if (!now.current)
    return 'The line’s cue, text, voice or settings changed since. Take it again to use a take.'
  return now.pending && 'This take is being used as the clip. Wait for it to finish.'
}

/** Why Generate is greyed: nothing to generate, a plan being worked out again, or a run starting. */
export function generateWhy(now: {
  nothing: boolean
  waiting: boolean
  starting: boolean
}): string | false {
  if (now.nothing) return 'Nothing is left to generate here. Change the filters or the lines first.'
  if (now.waiting) return 'The plan is being worked out again. Wait for it to finish.'
  return now.starting && 'The run is starting. Wait for it to begin.'
}

/** Why a run’s Cancel is greyed: it is already stopping, or clearing orphans, or the ask is sent. */
export function cancelRunWhy(now: {
  cancelling: boolean
  removingOrphans: boolean
  pending: boolean
}): string | false {
  if (now.removingOrphans) return 'Leftover clips are being removed. Wait for that to finish.'
  return (
    (now.cancelling || now.pending) &&
    'The run is already stopping. Wait for the lines under way to finish.'
  )
}
