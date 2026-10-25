/** The model Fish retires. */
export const RETIRED_MODEL = 's1'

/** The model Fish serves and bills in its place, at the same price. */
export const REPLACEMENT_MODEL = 's2.1-pro'

/** The first day on which `s1` is gone (1 January 2027, UTC). */
const RETIRED_FROM = Date.UTC(2027, 0, 1)

/** The recordings that use a model of their own: the draft takes and the final takes. */
export type Take = 'draft' | 'final'

/** The takes whose model is the retired one, draft first (the audition model is never one). */
export function retiringTakes(models: { draft: string; final: string }): Take[] {
  return (['draft', 'final'] as const).filter((take) => models[take] === RETIRED_MODEL)
}

/** Whether `now` is on or after the day after the retirement. */
export function hasRetired(now: Date): boolean {
  return now.getTime() >= RETIRED_FROM
}

/** "draft and final", "draft" or "final": the takes as a phrase. */
function named(takes: Take[]): string {
  return takes.join(' and ')
}

/** The banner's heading and body for the takes still on s1, in the tense of `now`. */
export function bannerWords(takes: Take[], now: Date): { heading: string; body: string } {
  const which = `${named(takes)} takes`
  if (hasRetired(now)) {
    return {
      heading: 's1 retired on 31 December 2026',
      body: `Fish no longer has s1: this project's ${which} are now recorded with s2.1-pro, at the same price. Switch to say so in the project file.`,
    }
  }
  return {
    heading: 's1 retires on 31 December 2026',
    body: `This project records its ${which} with s1. From 1 January Fish records them with s2.1-pro instead, at the same price.`,
  }
}

/** The lines of the question before the switch: each take that changes, then what stays. */
export function questionItems(takes: Take[], projectFile = 'audio-studio.json'): string[] {
  return [
    ...takes.map((take) => `${capital(take)}: s1 → s2.1-pro`),
    `Saved in ${projectFile}; nothing else in it changes.`,
    'Lines already recorded with s1 stay as they are.',
  ]
}

/** The confirmation's body after the switch. */
export function doneWords(takes: Take[], projectFile: string): string {
  const subject =
    takes.length > 1 ? `${capital(named(takes))} now use` : `${capital(takes[0]!)} now uses`
  return `${subject} s2.1-pro, saved in ${projectFile}. Lines already recorded with s1 stay as they are.`
}

/** The failure's body: the file, and why nothing was saved. */
export function failureBody(projectFile: string, reason: string): string {
  return `${projectFile} could not be saved: ${reason}. Nothing was changed.`
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
