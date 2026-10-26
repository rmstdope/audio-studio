import type { GenerationPlan } from '../core/generation'
import type { Recorded } from '../core/summary'
import type { LanguageProgress } from '../services/workspace'
import { plural } from './format'

/** What a language shows in the switch: its count, hover text, and whether it is dimmed. */
export function languageTab(
  language: LanguageProgress,
  partTitle: string,
): { count: string; title: string; dimmed: boolean; warn?: true } {
  if (language.dialog === 'gone') {
    return {
      count: 'Dialog gone',
      title: `${partTitle}’s ${language.name} dialog is gone`,
      dimmed: false,
      warn: true,
    }
  }
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
export function planHeadline(
  plan: Pick<GenerationPlan, 'keys' | 'final' | 'uncast' | 'untranslated'>,
): string {
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
  sourceInside = false,
): string | null {
  if (from === 'source') {
    return sourceInside ? `from ${source} · cues inside stay with ${source}` : `from ${source}`
  }
  return from === 'style' ? `${character}’s style` : null
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

/** What was recorded, in words: "12 clips and 3 cues", naming only what exists. */
export function recordedWords(recorded: Recorded): string {
  return [
    recorded.clips ? plural(recorded.clips, 'clip') : '',
    recorded.cues ? plural(recorded.cues, 'cue') : '',
  ]
    .filter(Boolean)
    .join(' and ')
}

/**
 * The words of the panels for a dialog that is gone while recordings were made with it: the
 * heading, the sentence that follows the file's path, the advice, the lines page's sentence, and
 * whether the game can refresh. The language is null in a one-language project.
 */
export function dialogGonePanel({
  partTitle,
  partLabel,
  language,
  recorded,
  canRefresh,
}: {
  partTitle: string
  partLabel: string
  language: string | null
  recorded: Recorded
  canRefresh: boolean
}): { heading: string; before: string; advice: string; lines: string; refresh: boolean } {
  const words = recordedWords(recorded)
  const one = recorded.clips + recorded.cues === 1
  const were = one ? 'was' : 'were'
  const dropped = `If the game no longer has ${language ? `${language} lines for ` : ''}this ${partLabel.toLowerCase()}, delete the clips and their manifest yourself.`
  return {
    heading: `${partTitle}’s ${language ? `${language} ` : ''}dialog is gone`,
    before: ` is not there, but ${words} ${were} recorded for ${partTitle}${
      language ? ` in ${language}` : ''
    }. The studio keeps ${one ? 'it as it is' : 'them as they are'} and offers to remove none of ${
      one ? 'it' : 'them'
    } until the dialog is back.`,
    advice: `${
      canRefresh
        ? 'Refresh dialog writes it again from the game.'
        : 'Once the game writes it again, the studio reads it in.'
    } ${dropped}`,
    lines: `${words} ${were} recorded for these lines. Nothing can be generated or removed until the dialog is back.`,
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
