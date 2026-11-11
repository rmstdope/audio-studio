import { effectSeconds, type EffectsSummary } from '../core/effects'

/** The line under the Sound effects title: how many are chosen, and how many could not be read. */
export function effectsSubtitle(effects: EffectsSummary): string {
  const lead = 'The sound effects the game asks for.'
  if (effects.status !== 'ok' || effects.rows.length === 0) return lead
  // Which are chosen is not known while the lock cannot be read: no count to give.
  if (effects.rows.every((row) => row.status === 'unknown')) return lead
  const chosen = effects.rows.filter((row) => row.chosen).length
  const missing = effects.rows.filter((row) => row.status === 'missing').length
  const parts = [
    `${chosen} of ${effects.rows.length} chosen`,
    ...(missing ? [missing === 1 ? '1 clip is missing' : `${missing} clips are missing`] : []),
    ...(effects.unreadable ? [`${effects.unreadable} could not be read`] : []),
  ]
  return `${lead} ${parts.join('; ')}.`
}

/** The one line that stands in for the table, or null when there is a table (or problems to read). */
export function effectsNotice(effects: EffectsSummary): string | null {
  if (effects.status === 'missing') {
    return `The game has not listed its sound effects yet.${effects.canRefresh ? ' Refresh from the game.' : ''}`
  }
  if (effects.status === 'invalid') {
    return 'The list of sound effects could not be read; the problems above say why.'
  }
  if (effects.rows.length === 0 && effects.unreadable === 0) {
    return 'The game asks for no sound effects.'
  }
  return null
}

/** What a refresh did, for its panel: the headline and the ids added and removed. */
export function effectsRefreshSummary(
  total: number,
  change: { added: string[]; removed: string[] } | null,
): { headline: string; added: string[]; removed: string[] } {
  const count = `${total} sound ${total === 1 ? 'effect' : 'effects'}`
  if (!change) return { headline: `${count} · what changed is not known`, added: [], removed: [] }
  const parts = [
    change.added.length ? `${change.added.length} added` : null,
    change.removed.length ? `${change.removed.length} removed` : null,
  ].filter(Boolean)
  return {
    headline: [count, ...(parts.length ? parts : ['no changes'])].join(' · '),
    added: change.added,
    removed: change.removed,
  }
}

/** The Length line of an effect's page: "10 s · loops · set by the game". */
export function effectLengthLine(seconds: number, loops: boolean): string {
  return `${effectSeconds(seconds)} · ${loops ? 'loops · ' : ''}set by the game`
}

/** Why a control waits for a change that is already under way. */
export const EFFECTS_PENDING = 'Wait for the current change to finish.'

/** Why the sound effects lock being unreadable keeps choosing, dropping and fading off. */
export const EFFECTS_LOCK_UNREAD =
  'The sound effects lock cannot be read. Choosing, dropping and fading wait until it can be.'

/** Why Fades… is off while another take's fades are open. */
export function effectFadesOpenWhy(fading: number): string {
  return `Close the fades of Take ${fading} first.`
}

/**
 * Why making sound-effect takes (the Make button, the model menu, Try again) is off, in the order
 * to deal with it: Setup first, then the words being saved, takes being made, a change under way;
 * null when it is on.
 */
export function effectsMakeWhy(state: {
  canMake: boolean
  busy: boolean
  waitingForWords: boolean
  pending: boolean
}): string | null {
  if (!state.canMake)
    return 'Neither sound-effects model can run on this computer. Setup says what is missing.'
  if (state.waitingForWords)
    return 'The effect’s words are being saved. This turns on when they are.'
  if (state.busy)
    return 'Takes are being made for this effect. Make more when they are done, or Stop.'
  if (state.pending) return EFFECTS_PENDING
  return null
}
