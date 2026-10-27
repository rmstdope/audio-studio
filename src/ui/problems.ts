import type { Problem } from '../core/project'

/**
 * The problems a part's own banner lists: the part's, less those the page's top banner already
 * shows from the project summary, so a broken cast file is read about once.
 */
export function partOnlyProblems(part: Problem[], shown: Problem[]): Problem[] {
  const key = (p: Problem) => JSON.stringify([p.file, p.path, p.message])
  const seen = new Set(shown.map(key))
  return part.filter((p) => !seen.has(key(p)))
}
