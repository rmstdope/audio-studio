import type { ConflictKind, ImageRow, ImagesSummary } from '../core/images'
import type { SetAsideAsk, SetAsideQuestion } from '../core/imagePatches'
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

/** The count at the head of the Named areas panel. */
export function areasCountText(placed: number, total: number): string {
  return `${placed} of ${total} placed`
}

/** The line under an image's status on the act's list: how many named areas are left; null when none are. */
export function areasToPlaceText(left: number, total: number): string | null {
  return left > 0 ? `${left} of ${total} ${total === 1 ? 'area' : 'areas'} to place` : null
}

/** The palette's size, as the Style page shows it. */
export function paletteText(count: number): string {
  return `${count} ${count === 1 ? 'colour' : 'colours'}`
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

/** The line saying a patch's mark came from its named area. */
export function markedFromAreaText(title: string): string {
  return `Marked from the named area “${title}”, with a little room around it. Drag over the picture to change it.`
}

/** The line saying a patch's named area has no place yet. */
export function areaNoPlaceText(title: string): string {
  return `“${title}” has no place yet. Mark it under Named areas and this patch starts there, or drag over the picture to mark this patch by hand.`
}

/** The button that sends a patch's mark back to its named area. */
export function backToAreaText(title: string): string {
  return `Back to “${title}”`
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

/** The title of the question asked before choosing, un-choosing or dropping a take. */
export function setAsideTitle(ask: SetAsideAsk, from: number): string {
  return ask.kind === 'choose'
    ? `Choose take ${ask.n}?`
    : ask.kind === 'drop'
      ? `Drop take ${ask.n}?`
      : `Un-choose take ${from}?`
}

/** What choosing away from a take does to its chosen patches (`count` of them, made on take `from`). */
export function setAsideSentence(from: number, count: number): string {
  return count === 1
    ? `1 chosen patch was made on take ${from}. The game will stop showing it until you make a new one.`
    : `${count} chosen patches were made on take ${from}. The game will stop showing them until you make new ones.`
}

/** What dropping a take does to its chosen patches. */
export function setAsideDropSentence(from: number, count: number): string {
  return count === 1
    ? `1 chosen patch was made on take ${from}. After this it cannot be brought back; only a new one can be made.`
    : `${count} chosen patches were made on take ${from}. After this they cannot be brought back; only new ones can be made.`
}

/** The dim line of a Choose or Un-choose question: the way back, and what comes back with the new take. */
export function setAsideDim(q: SetAsideQuestion): string {
  if (q.returning.length === 0) {
    return `Choosing take ${q.from} again brings ${q.leaving.length === 1 ? 'it' : 'them all'} back.`
  }
  const n = q.returning.length
  const comes = `${n} ${n === 1 ? 'patch' : 'patches'} made on take ${q.to} ${n === 1 ? 'comes' : 'come'} back: ${q.returning.join(', ')}.`
  return `${comes} Choosing take ${q.from} again brings ${joined(q.leaving)} back.`
}

/** The line on an act's row naming the patches to make again. */
export function makeAgainActLine(titles: string[]): string {
  return `make again: ${titles.join(', ')}`
}

/**
 * The line above an opened patch to make again: the takes of the image it was chosen on (none: they
 * were dropped) and how to get it back, given the take chosen now (null: none is).
 */
export function makeAgainOpenLine(takes: number[], chosen: number | null): string {
  if (takes.length === 0) {
    return 'Chosen on an earlier take of the image, so the game does not show it now. Make a new one here.'
  }
  const where = `${takes.length === 1 ? 'take' : 'takes'} ${joined(takes.map(String))}`
  const back = takes.length === 1 ? `take ${takes[0]}` : 'one of those takes'
  const way =
    chosen === null
      ? `Choose ${back} again to bring it back.`
      : `Make a new one here, or choose ${back} again to bring it back.`
  return `Chosen on ${where} of the image, so the game does not show it now. ${way}`
}

/** The smallest share of the game's size the two pictures are shrunk to side by side, before they stack. */
const SMALLEST_BESIDE = 0.5

/** The smallest share of the game's size a stacked picture is shown at. */
const SMALLEST_STACKED = 0.1

/** A zoom below 1, rounded down to hundredths so the pictures never overflow. */
const shrunk = (zoom: number) => Math.floor(zoom * 100) / 100

/**
 * How big the takes' pictures are shown, as a multiple of the game's `width`, and whether the
 * workbench's two sides stack. Side by side in `available` pixels: the largest whole number at
 * which both fit; when not even ×1 fits, shrunk to fit, down to half the game's size. Below that
 * they stack, each fitted to the width (at most ×1, at least a tenth). An unknown width (0) shows ×1
 * side by side.
 */
export function lookZoom(
  available: number,
  gap: number,
  width: number,
): { zoom: number; stacked: boolean } {
  if (available <= 0 || width <= 0) return { zoom: 1, stacked: false }
  const beside = (available - gap) / (2 * width)
  if (beside >= 1) return { zoom: Math.floor(beside), stacked: false }
  if (beside >= SMALLEST_BESIDE) return { zoom: shrunk(beside), stacked: false }
  // Never below a tenth: while the stage is being laid out it can measure a few pixels.
  return { zoom: Math.max(SMALLEST_STACKED, shrunk(Math.min(1, available / width))), stacked: true }
}

/**
 * How a picture at `zoom` is drawn: with hard pixels at a whole size, as the game's pixel art is;
 * smooth when shrunk, where hard pixels would drop some of them unevenly.
 */
export function pictureRendering(zoom: number): 'pixelated' | 'auto' {
  return zoom < 1 ? 'auto' : 'pixelated'
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

/** The line under the picture of the Named areas panel: what can be done now. */
export function areaLineText(selected: { title: string; placed: boolean } | null): string {
  if (!selected) return 'Press an area in the list or on the picture to change it.'
  return selected.placed
    ? 'Drag the box to move it, or its corners and sides to resize it. Arrow keys move it; with Shift they resize it.'
    : `Drag over the picture to mark “${selected.title}”.`
}

/** The red line when a box could not be saved: the area's title and the reason. */
export function areaSaveFailedText(title: string, reason: string): string {
  return `“${title}” could not be saved: ${reason.replace(/\.$/, '')}.`
}

/** The widest a title is on the picture, in characters, before it is cut short with "…". */
export const AREA_TAG_WIDEST = 16

/** A title as the picture's tag shows it: cut short at the widest size. */
export function areaTagText(title: string): string {
  return title.length > AREA_TAG_WIDEST ? `${title.slice(0, AREA_TAG_WIDEST)}…` : title
}

/** What a change to takes answered, as a line to show when it was refused. */
export function refusal(answer: unknown): string | null {
  if (!answer || typeof answer !== 'object' || !('ok' in answer) || answer.ok) return null
  return 'message' in answer && typeof answer.message === 'string'
    ? answer.message
    : 'That could not be done.'
}

/** The heading of the warning on an image's page: the pair when there is one, else a shorter line above the list. */
export function overlapHeading(pairs: readonly [string, string][]): string {
  return pairs.length === 1
    ? `Two chosen patches overlap: ${overlapPairLine(pairs[0]!)}.`
    : 'Some chosen patches overlap.'
}

/** One overlapping pair, earlier patch first. */
export function overlapPairLine(pair: readonly [string, string]): string {
  return `${pair[0]} and ${pair[1]}`
}

/** What the warning on an image's page says under its heading. */
export const OVERLAP_EXPLANATION =
  'If the game shows both at once, one is drawn over the other where they meet.'

/** The line at the top of an open patch whose chosen take overlaps these patches. */
export function overlapOpenLine(titles: string[]): string {
  return `The chosen take overlaps ${joined(titles)}.`
}

/** The line in an image's Prompt cell on an act's page naming every overlapping pair. */
export function overlapActLine(pairs: readonly [string, string][]): string {
  return `patches overlap: ${pairs.map(overlapPairLine).join('; ')}`
}
