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

/** "1 chosen patch" or "3 chosen patches". */
const patchCount = (n: number) => `${n} chosen ${n === 1 ? 'patch' : 'patches'}`

/** "1 placed named area" or "5 placed named areas". */
const areaCount = (n: number) => `${n} placed named ${n === 1 ? 'area' : 'areas'}`

/**
 * The sentence that opens a question: what the game does with what leaves. Patches alone keep the
 * words of the patch question; areas alone and both have their own.
 */
export function setAsideLead(ask: SetAsideAsk, q: SetAsideQuestion): string {
  const patches = q.leaving.length
  const areas = q.leavingAreas.length
  const dropping = ask.kind === 'drop'
  if (areas === 0) {
    return dropping ? setAsideDropSentence(q.from, patches) : setAsideSentence(q.from, patches)
  }
  if (patches === 0) {
    const one = areas === 1
    if (dropping) {
      return `${areas} named ${one ? 'area was' : 'areas were'} placed on take ${q.from}. After this ${one ? 'it cannot' : 'they cannot'} be brought back; only ${one ? 'a new one can' : 'new ones can'} be placed.`
    }
    const where = q.to === null ? 'another take' : `take ${q.to}`
    return `${areas} named ${one ? 'area is' : 'areas are'} placed on take ${q.from}. The game will stop using ${one ? 'it' : 'them'} until you place ${one ? 'it' : 'them'} on ${where}.`
  }
  const has = `Take ${q.from} has ${patchCount(patches)} and ${areaCount(areas)}.`
  return dropping
    ? `${has} After this they cannot be brought back; only new ones can be made and placed.`
    : `${has} The game will stop showing the ${patches === 1 ? 'patch' : 'patches'} and stop using the ${areas === 1 ? 'area' : 'areas'} until you make and place them again.`
}

/** The dim line of a Choose or Un-choose question: the way back, and what comes back with the new take. */
export function setAsideDim(q: SetAsideQuestion): string {
  const leaves = q.leaving.length + q.leavingAreas.length
  const withAreas = q.leavingAreas.length > 0 || q.returningAreas > 0
  if (q.returning.length === 0 && q.returningAreas === 0) {
    return `Choosing take ${q.from} again brings ${leaves === 1 ? 'it' : 'them all'} back.`
  }
  const comes: string[] = []
  if (q.returning.length > 0) {
    const n = q.returning.length
    comes.push(
      `${n} ${n === 1 ? 'patch' : 'patches'} made on take ${q.to} ${n === 1 ? 'comes' : 'come'} back: ${q.returning.join(', ')}.`,
    )
  }
  if (q.returningAreas > 0) {
    const n = q.returningAreas
    comes.push(
      `${n} named ${n === 1 ? 'area' : 'areas'} placed on take ${q.to} ${n === 1 ? 'comes' : 'come'} back.`,
    )
  }
  const brings = withAreas ? 'brings back what leaves now' : `brings ${joined(q.leaving)} back`
  return `${comes.join(' ')} Choosing take ${q.from} again ${brings}.`
}

/**
 * The line above the list of areas to place again (`count` of them): the takes they were placed on
 * (none: those takes were dropped) and how to get them back, given the take chosen now (null: none).
 */
export function placeAgainLine(takes: number[], chosen: number | null, count: number): string {
  const one = count === 1
  const use = `so the game does not use ${one ? 'it' : 'them'} now.`
  if (takes.length === 0) {
    return `Placed on an earlier take of the image, ${use}${chosen === null ? '' : ` Place ${one ? 'it' : 'them'} here.`}`
  }
  const where = `${takes.length === 1 ? 'take' : 'takes'} ${joined(takes.map(String))}`
  const back = takes.length === 1 ? `take ${takes[0]}` : 'one of those takes'
  const bring = `bring ${one ? 'it' : 'them'} back`
  const way =
    chosen === null
      ? `Choose ${back} again to ${bring}.`
      : `Place ${one ? 'it' : 'them'} here, or choose ${back} again to ${bring}.`
  return `Placed on ${where} of the image, ${use} ${way}`
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
 * How big the two pictures are shown when the stage has a known height as well: as large as both
 * fit side by side in `availableWidth` x `availableHeight` (a hundredth of the game's size at a
 * time, at least a tenth), keeping their shape. With no known height (0) it is `lookZoom`.
 */
export function fitZoom(
  availableWidth: number,
  availableHeight: number,
  gap: number,
  width: number,
  height: number,
): { zoom: number; stacked: boolean } {
  if (availableHeight <= 0 || availableWidth <= 0 || width <= 0 || height <= 0) {
    return lookZoom(availableWidth, gap, width)
  }
  const fit = Math.min((availableWidth - gap) / (2 * width), availableHeight / height)
  return { zoom: Math.max(SMALLEST_STACKED, shrunk(fit)), stacked: false }
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
    ? 'Drag the box to move it, or its corners and sides to resize it. Drag the point to choose where What’s there marks it. Arrow keys move the box; with Shift they resize it; with Alt they move the point.'
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

/** The reason when a change is on its way to the studio and the control waits for the answer. */
export const WAIT_FOR_CHANGE = 'Wait for the current change to finish.'

/** The tip on a fine-tune's Use this and Drop in the second after it turns ready. */
export const JUST_FINISHED = 'Just finished — a moment…'

/** Why a model cannot be used: it is not on this computer. */
export function modelMissingWhy(name: string): string {
  return `${name} is not on this computer. Setup says how to download it.`
}

/** What keeps a patch's take count and model menu off, the first to deal with; null when nothing. */
export function patchMenuWhy(now: {
  makerMessage: string | null
  making: boolean
  savingWords: boolean
}): string | null {
  if (now.makerMessage) return now.makerMessage
  if (now.making)
    return 'Takes are being made for this patch. Change this when they are done, or Stop.'
  if (now.savingWords) return 'The patch’s words are being saved. This turns on when they are.'
  return null
}

/**
 * What keeps a patch's Make button off, the first to deal with: the maker, the model, the patch's
 * place, then the waiting. `mark` is `none` when the patch has no mark; null when nothing does.
 */
export function patchMakeWhy(now: {
  makerMessage: string | null
  modelName: string
  modelHere: boolean
  mark: 'placed' | 'none'
  /** The patch's named area, when it has one. */
  areaTitle: string | null
  making: boolean
  savingWords: boolean
}): string | null {
  if (now.makerMessage) return now.makerMessage
  if (!now.modelHere) return modelMissingWhy(now.modelName)
  if (now.mark === 'none')
    return now.areaTitle !== null
      ? `“${now.areaTitle}” has no place yet. Mark it under Named areas, or drag over the picture to mark this patch.`
      : 'This patch has no mark yet. Drag over the picture to mark where it goes.'
  if (now.making)
    return 'Takes are being made for this patch. Make more when they are done, or Stop.'
  if (now.savingWords) return 'The patch’s words are being saved. Make turns on when they are.'
  return null
}

/** Why an image's take count and model menu are off: the generator, takes being made, words saving. */
export function imageMenuWhy(now: {
  generatorOk: boolean
  making: boolean
  savingWords: boolean
}): string | null {
  if (!now.generatorOk) return GENERATOR_MISSING
  if (now.making)
    return 'Takes are being made for this image. Change this when they are done, or Stop.'
  if (now.savingWords) return 'The image’s words are being saved. This turns on when they are.'
  return null
}

/** Why an image's Make button is off, in the same order. */
export function imageMakeWhy(now: {
  generatorOk: boolean
  making: boolean
  savingWords: boolean
}): string | null {
  if (!now.generatorOk) return GENERATOR_MISSING
  if (now.making)
    return 'Takes are being made for this image. Make more when they are done, or Stop.'
  if (now.savingWords) return 'The image’s words are being saved. Make turns on when they are.'
  return null
}

/** Why nothing can be made: no image model can run here. */
const GENERATOR_MISSING = 'No image model can run on this computer. Setup says what is missing.'

/** Why choosing, dropping and un-choosing wait: the images lock cannot be read. */
export const IMAGES_LOCK_WHY =
  'The images lock cannot be read, so choosing, dropping and un-choosing wait. Fix the lock file, then reload.'

/** Why a take cannot be chosen: the style has a problem. */
export const STYLE_BROKEN_WHY = 'The style needs fixing first. Fix it to choose this take.'

/** Why a take cannot be chosen yet: it is still being brought to the game's look. */
export const BRINGING_WHY =
  'This take is still being brought to the game’s look. Choose it when that is done.'

/** Why a take's buttons are off while a question about it is open. */
export const QUESTION_OPEN_WHY = 'Answer or cancel the question first.'

/** Why a named area cannot be picked yet, by what its picture is doing; null when it can be. */
export function areaRowWhy(state: 'loading' | 'gone' | 'none' | 'ready'): string | null {
  if (state === 'loading') return 'The picture is still loading. Pick an area when it has.'
  if (state === 'gone')
    return "The chosen take's picture is missing or cannot be read, so areas cannot be placed on it."
  if (state === 'none')
    return 'Choose a take of the image first. Areas are placed on the take the game shows.'
  return null
}
