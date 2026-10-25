import type { LanguageProgress } from '../services/workspace'
import { plural } from './format'

/** What a language shows in the switch: its count, hover text, and whether it is dimmed. */
export function languageTab(
  language: LanguageProgress,
  partTitle: string,
): { count: string; title: string; dimmed: boolean } {
  if (language.dialog === 'missing') {
    return {
      count: 'No dialog',
      title: `${partTitle} has no ${language.name} dialog yet`,
      dimmed: true,
    }
  }
  return {
    count: `${language.upToDate}/${language.total}`,
    title: `${language.upToDate} of ${language.total} lines up to date`,
    dimmed: false,
  }
}

/** The Generate panel's label: what it does, in which language (none in a one-language project), for whom. */
export function generateLabel(
  what: string,
  language: string | null,
  character: string | null,
): string {
  return [what, language, character ?? 'every character'].filter(Boolean).join(' · ')
}

/**
 * The Generate panel's heading: how many lines it would record; with none, that every line is
 * recorded (or final) only when no line in scope is waiting for a voice or a translation.
 */
export function planHeadline(plan: {
  keys: string[]
  final: boolean
  uncast: string[]
  untranslated: number
}): string {
  if (plan.keys.length) return `Record ${plural(plan.keys.length, 'line')}`
  if (plan.uncast.length || plan.untranslated) return 'Nothing to record yet'
  return plan.final ? 'Every line is final' : 'Every line is recorded'
}

/** Who cannot be recorded for want of a voice (in the language, when there are several). */
export function castNote(language: string | null, names: string[]): string {
  return `Not recorded until cast${language ? ` in ${language}` : ''}: ${names.join(', ')}.`
}

/** How many lines are not recorded because they have no text in the language yet. */
export function translatedNote(lines: number): string {
  return `Not recorded until translated: ${lines} ${lines === 1 ? 'line' : 'lines'}.`
}

/** Where a line's cue comes from, under it: the source language's, or the character's style. */
export function cueNote(
  from: 'own' | 'source' | 'style',
  character: string,
  source: string,
): string | null {
  return from === 'source' ? `from ${source}` : from === 'style' ? `${character}’s style` : null
}

/**
 * The hint under the cue field in a language besides the source: that an empty field follows the
 * source's cue, or what the source's cue is. Nothing when the source has none to show.
 */
export function cueHint(
  from: 'own' | 'source' | 'style',
  sourceCue: string | null,
  source: string,
): string | null {
  if (!sourceCue) return null
  return from === 'source'
    ? `Empty: this line follows the ${source} cue ${sourceCue}.`
    : from === 'own'
      ? `${source} cue: ${sourceCue}`
      : null
}

/** The hover text of the cue button of a line that follows the source language's cue. */
export function cueButtonTitle(
  from: 'own' | 'source' | 'style',
  language: string,
  source: string,
): string {
  return from === 'source'
    ? `Follows the ${source} cue: give this line its own ${language} cue`
    : from === 'own'
      ? 'This line’s own cue: edit'
      : 'The character’s style: give this line its own cue'
}

/** The panel for a language with no dialog for the part; the button only if the game can refresh. */
export function noDialogPanel(
  partTitle: string,
  name: string,
  canRefresh: boolean,
  partLabel: string,
): { heading: string; text: string; refresh: boolean } {
  return {
    heading: `${partTitle} has no ${name} dialog yet`,
    text: `The game has not written ${name} lines for this ${partLabel.toLowerCase()}. Once it does, ${
      canRefresh ? 'Refresh dialog' : 'the studio'
    } reads them in.`,
    refresh: canRefresh,
  }
}

/** The language an arrow, Home or End key moves to from `current` (wrapping round), or null for any other key. */
export function movedTo(ids: string[], current: string, key: string): string | null {
  const at = ids.indexOf(current)
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[key]
  if (key === 'Home') return ids[0] ?? null
  if (key === 'End') return ids.at(-1) ?? null
  if (step === undefined || at < 0) return null
  return ids[(at + step + ids.length) % ids.length] ?? null
}
