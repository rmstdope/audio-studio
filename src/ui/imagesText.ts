import type { ImageRow, ImagesSummary } from '../core/images'
import type { ImagesRoute } from './route'

/** The line under an act's heading: how many of its images have a chosen one. */
export function chosenLine(name: string, total: number, chosen: number): string {
  return `The images the game asks for in ${name}. ${chosen} of ${total} chosen.`
}

/** Words joined as "a, b and c". */
export function joined(words: string[]): string {
  return words.length < 2
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}

/** What an out-of-date image changed since it was chosen. */
export function outOfDateText(reasons: ImageRow['reasons']): string {
  return `Out of date since it was chosen: ${joined(reasons)}.`
}

/** The palette's size, as the Style page shows it. */
export function paletteText(count: number): string {
  return `${count} ${count === 1 ? 'colour' : 'colours'} · set by the game`
}

/** What the notice for a changed game style says of the images it leaves out of date. */
export function styleNoticeText(count: number): string {
  return count === 1
    ? '1 chosen image across all acts was made with the old style and is out of date. The game shows it until you choose a new one.'
    : `${count} chosen images across all acts were made with the old style and are out of date. The game shows them until you choose new ones.`
}

/**
 * The act whose page the route shows: the act asked for, the act of the image asked for, else the
 * first. Null on the Style page.
 */
export function currentAct(images: ImagesSummary, route: ImagesRoute): string | null {
  if (route.page === 'style') return null
  if (route.page === 'act') return route.part
  if (route.page === 'image') {
    return images.acts.find((act) => act.rows.some((row) => row.id === route.image))?.id ?? null
  }
  return images.acts[0]?.id ?? null
}

/** The count menu's entry: "1 take", "2 takes". */
export function takeCountText(n: number): string {
  return `${n} ${n === 1 ? 'take' : 'takes'}`
}

/** The make button: "Make 2 takes", or "Make 2 more takes" once the image has some. */
export function makeTakesText(count: number, hasTakes: boolean): string {
  return `Make ${count}${hasTakes ? ' more' : ''} ${count === 1 ? 'take' : 'takes'}`
}

/** What the Un-choose question says will happen. */
export function unchooseNote(take: number): string {
  return `The game shows no image here until you choose another. Take ${take} stays among the takes.`
}
