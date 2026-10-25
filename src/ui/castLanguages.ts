import type { AuditionText } from '../core/takes'
import type { CharacterSummary } from '../core/summary'

/** A declared language, named in itself. */
export interface Language {
  id: string
  name: string
}

/** The language a page shows: the one the address names if the project declares it, else the first. */
export function languageShown(languages: Language[], asked: string | undefined): string {
  return languages.find((l) => l.id === asked)?.id ?? languages[0]?.id ?? ''
}

/**
 * The language a page asks the server for and keys its cached answers by: the one shown in a
 * project with several, none in a project with one, so every part of a page agrees on the key.
 */
export function queryLanguage(
  languages: Language[],
  asked: string | undefined,
): string | undefined {
  return isMultilingual(languages) ? languageShown(languages, asked) : undefined
}

/** Whether the project narrates in more than one language, so pages show languages at all. */
export function isMultilingual(languages: Language[]): boolean {
  return languages.length > 1
}

/** The name of a language, from its code (the code itself when it is not declared). */
export function nameOf(languages: Language[], id: string): string {
  return languages.find((l) => l.id === id)?.name ?? id
}

/** What a language's tab says about her casting there: the state, the hover text, whether it is dimmed. */
export function castTab(
  character: CharacterSummary,
  language: Language,
  auditioning: boolean,
): { count: string; title: string; dimmed: boolean } {
  if (auditioning) return { count: 'Audition', title: 'Audition in progress', dimmed: false }
  const casting = character.languages[language.id]
  if (casting?.voice) {
    return { count: 'Cast', title: casting.voiceName || casting.voice, dimmed: false }
  }
  return { count: 'No voice', title: `No ${language.name} voice yet`, dimmed: true }
}

/** The chips a card adds: "No Deutsch voice" for each language but the first in which she has none. */
export function missingVoiceChips(character: CharacterSummary, languages: Language[]): string[] {
  return languages
    .slice(1)
    .filter((l) => !character.languages[l.id]?.voice)
    .map((l) => `No ${l.name} voice`)
}

/**
 * What a voice on the shortlist is noted as: "Cast now" for her voice in this language, "Her
 * English voice" for her voice in another; nothing for any other voice.
 */
export function shortlistNote(
  character: CharacterSummary,
  languages: Language[],
  language: string,
  voice: string,
): string | undefined {
  if (character.languages[language]?.voice === voice) return 'Cast now'
  const other = languages.find(
    (l) => l.id !== language && character.languages[l.id]?.voice === voice,
  )
  return other ? `Her ${other.name} voice` : undefined
}

/** The explanation under "No Deutsch voice yet": her other voices start the audition's shortlist. */
export function noVoiceText(
  character: CharacterSummary,
  languages: Language[],
  language: string,
): string {
  const name = nameOf(languages, language)
  const others = languages
    .filter((l) => l.id !== language)
    .flatMap((l) => {
      const voice = character.languages[l.id]
      return voice?.voice ? [`${voice.voiceName || voice.voice} (${l.name})`] : []
    })
  const middle = others.length
    ? ` ${joinNames(others)} start${others.length === 1 ? 's' : ''} on its shortlist, so you can hear ${others.length === 1 ? 'it' : 'them'} speak ${name} too.`
    : ''
  return `Start an audition to find one.${middle} Until then ${character.name}’s ${name} lines cannot be recorded.`
}

/** "A", "A and B", "A, B and C". */
function joinNames(names: string[]): string {
  return names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** A speed as the page writes it: `0.9×`. */
export function speedText(speed: number): string {
  return `${Number.isInteger(speed) ? speed.toFixed(1) : speed}×`
}

/**
 * The delivery panel's speed in a language: its label, the value now (the project's speed when the
 * language has none of its own), and beneath it the other languages' speeds, each in turn.
 */
export function speedInLanguage(
  character: CharacterSummary,
  languages: Language[],
  language: string,
  projectSpeed: number,
): { label: string; own: number | null; others: string } {
  const others = languages
    .filter((l) => l.id !== language)
    .map((l) => {
      const own = character.languages[l.id]?.speed ?? null
      return own === null
        ? `${l.name} ${speedText(projectSpeed)} (project’s speed)`
        : `${l.name} ${speedText(own)}`
    })
  return {
    label: `Speed · ${nameOf(languages, language)}`,
    own: character.languages[language]?.speed ?? null,
    others: others.join(' · '),
  }
}

/** The note under the audition phrase: where it comes from, in this language. */
export function phraseNote(audition: AuditionText, characterName: string, languageName: string) {
  if (audition.from === 'own') return `${characterName}’s own ${languageName} phrase.`
  if (audition.from === 'line') return `Her longest ${languageName} line, until you choose another.`
  if (audition.from === 'standard') return `The project’s standard ${languageName} phrase.`
  return null
}

/** What starting an audition cannot do without a phrase: its hover text, or null when it can start. */
export function startBlocked(audition: AuditionText | null, languageName: string): string | null {
  return audition && audition.phrase === null
    ? `Write a ${languageName} audition phrase first`
    : null
}

/** The explanation when there is no phrase to say: she has no lines in the language either. */
export function noPhraseText(characterName: string, languageName: string): string {
  return `${characterName} has no ${languageName} lines to borrow one from. Write a ${languageName} phrase to start an audition.`
}

/** The question before casting in a language, and what it makes stale. */
export function castInLanguage(
  voiceTitle: string,
  characterName: string,
  languages: Language[],
  language: string,
  recorded: { title: string; lines: number }[],
): { title: string; stale: string | null } {
  const name = nameOf(languages, language)
  const total = recorded.reduce((sum, a) => sum + a.lines, 0)
  const others = joinNames(languages.filter((l) => l.id !== language).map((l) => l.name))
  const where = recorded.map((a) => `${a.title} ${a.lines}`).join(', ')
  return {
    title: `Cast ${voiceTitle} as ${characterName}’s ${name} voice?`,
    stale: total
      ? `${total} ${name} ${total === 1 ? 'line goes stale and needs' : 'lines go stale and need'} recording again: ${where}. Her ${others} lines are not touched.`
      : null,
  }
}

/** What the page says once a voice is cast in a language. */
export function castSaved(languages: Language[], language: string, stale: number): string {
  const name = nameOf(languages, language)
  if (!stale) return `Saved to the ${name} cast for every act.`
  return `Saved to the ${name} cast for every act. ${stale} ${stale === 1 ? 'line is' : 'lines are'} now stale and ${stale === 1 ? 'needs' : 'need'} recording again.`
}
