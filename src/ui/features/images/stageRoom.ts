/** What `heightBesides` reads of a box in a side of the stage. */
export interface Box {
  parentElement: Box | null
  children: ArrayLike<unknown>
  offsetHeight: number
}

/**
 * The height `inside` holds besides `picture`: each sibling on the way up from the picture, and the
 * gaps between them, as laid out, and what each box on the way, the side itself included, takes besides its content
 * (`inset`: its padding and border). A side's own height is no help, a grid stretches it to the row.
 */
export function heightBesides<B extends Box>(
  picture: B,
  inside: B,
  rowGap: (box: B) => number,
  inset: (box: B) => number = () => 0,
): number {
  let total = 0
  for (let at = picture; at !== inside && at.parentElement; at = at.parentElement as B) {
    const parent = at.parentElement as B
    total += inset(parent)
    for (const sibling of Array.from(parent.children) as B[]) {
      if (sibling !== at) total += sibling.offsetHeight + rowGap(parent)
    }
  }
  return total
}

/**
 * What the sides of the stage hold besides their pictures: the larger of the sides that show one
 * (the right one may hold more under its picture than the left), or `null` when neither does (an
 * empty frame, a question open), in which case the room for the pictures is not known.
 */
export function stageChrome<B extends Box>(
  sides: { side: B; picture: B | null }[],
  rowGap: (box: B) => number,
  inset: (box: B) => number = () => 0,
): number | null {
  const found = sides.flatMap(({ side, picture }) =>
    picture ? [heightBesides(picture, side, rowGap, inset)] : [],
  )
  return found.length === 0 ? null : Math.max(...found)
}

/**
 * What the sides of the stage hold across besides their pictures: the padding and border across
 * (`inset`) of each box a picture sits inside, the side itself included, the larger of the sides',
 * or nothing when no side shows a picture. A side's picture is fitted to its column less this.
 */
export function stageAcross<B extends Box>(
  sides: { side: B; picture: B | null }[],
  inset: (box: B) => number,
): number {
  let most = 0
  for (const { side, picture } of sides) {
    if (!picture) continue
    let total = 0
    for (let at = picture; at !== side && at.parentElement; at = at.parentElement as B) {
      total += inset(at.parentElement as B)
    }
    most = Math.max(most, total)
  }
  return most
}
