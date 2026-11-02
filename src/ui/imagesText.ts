import type { ConflictKind, ImageRow, ImagesSummary } from '../core/images'
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

/** The separator before item `index` of `count` in "a, b and c". */
export function listSeparator(index: number, count: number): string {
  return index === 0 ? '' : index === count - 1 ? ' and ' : ', '
}

/**
 * What an out-of-date image changed since it was chosen; the act's style is named with the act's
 * short name, or for a shared image with the acts it was taken from now and when it was chosen.
 */
export function outOfDateText(
  reasons: ImageRow['reasons'],
  actName: string,
  change?: { now: string | null; was: string | null } | null,
): string {
  const actStyle = !change
    ? `${actName}'s style`
    : change.now !== null
      ? `${change.now}'s style${change.was !== null && change.was !== change.now ? ` instead of ${change.was}'s` : ''}`
      : change.was !== null
        ? `${change.was}'s style left out`
        : 'the act style'
  const named = reasons.map((r) => (r === 'the act style' ? actStyle : r))
  return `Out of date since it was chosen: ${joined(named)}.`
}

/** What an image whose lists disagree says: which acts, and about what. */
export function disagreeText(acts: string[], differs: ConflictKind[]): string {
  const about = joined(differs)
  return `The game's lists disagree about this image: ${joined(acts)} give it different ${about}. Fix them in the game, then Refresh from the game.`
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
 * The act whose page the route shows: the act asked for, for an image the act it was opened from
 * (else the first act that lists it), else the first. Null on the Style page.
 */
export function currentAct(images: ImagesSummary, route: ImagesRoute): string | null {
  if (route.page === 'style') return null
  if (route.page === 'act') return route.part
  if (route.page === 'image') {
    const lists = images.acts.filter((act) => act.order.includes(route.image))
    return (lists.find((act) => act.id === route.from) ?? lists[0])?.id ?? null
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

/**
 * How big the takes' pictures are shown, as a whole multiple of the game's `width`, and whether the
 * Takes section's two sides stack: the largest whole number at which both fit side by side in
 * `available` pixels; when not even ×1 fits they stack, each the largest whole number that fits
 * alone. An unknown width (0) shows ×1 side by side.
 */
export function lookZoom(
  available: number,
  gap: number,
  width: number,
): { zoom: number; stacked: boolean } {
  if (available <= 0 || width <= 0) return { zoom: 1, stacked: false }
  const beside = Math.floor((available - gap) / (2 * width))
  if (beside >= 1) return { zoom: beside, stacked: false }
  return { zoom: Math.max(1, Math.floor(available / width)), stacked: true }
}

/** The caption under the model's picture: its size, and that its edges are cut when it is another shape. */
export function modelCaption(width: number, height: number, cropped: boolean): string {
  return `${width} × ${height}${cropped ? ' · cropped to fit' : ''}`
}

/** The notice when the game's look changed, in three parts: bold, what changed, the rest. */
export function lookNoticeText(
  count: number,
  changed: string[],
): { head: string; what: string; rest: string } {
  const still =
    count === 1
      ? '1 image and its takes still have the old look.'
      : `${count} images and their takes still have the old look.`
  return {
    head: "The game's look changed",
    what: changed.length ? ` (${joined(changed)})` : '',
    rest: `${still} Nothing needs making again.`,
  }
}

/** The notice while images are being brought to the new look. */
export function bringingText(done: number, total: number): string {
  return `Bringing images to the new look… ${done} of ${total}`
}

/** The notice when some images could not be brought: what was done, and why the rest could not be. */
export function bringFailureText(
  total: number,
  failed: { reason: string }[],
): { head: string; rest: string } {
  const reasons = [
    ...new Set(
      failed.map((f) =>
        f.reason === 'missing'
          ? failed.length === 1
            ? "the model's picture is missing"
            : "the model's picture for each is missing"
          : f.reason,
      ),
    ),
  ]
  return {
    head: `Brought ${total - failed.length} of ${total} images to the new look.`,
    rest: `${failed.length} couldn't be: ${reasons.join('; ')}. ${failed.length === 1 ? 'Its' : 'Their'} old look stays until you make new takes.`,
  }
}
