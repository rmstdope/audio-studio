import type { LanguageProgress } from '../services/workspace'

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

/** The line above the table in a language that cannot be recorded yet. */
export function recordingNote(name: string): string {
  return `Recording in ${name} is not available yet: you can see and play its lines.`
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
