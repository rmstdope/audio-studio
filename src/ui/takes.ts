/** The part of a candidates answer that takes belong to. */
interface WithTakes {
  audition: { spoken: string }
  takes: Record<string, string>
}

/**
 * The candidates with a newly recorded take added, if it is a take of the phrase they show; a
 * take of a phrase changed since it was asked for is left out, so the old words never play as new.
 */
export function withTake<T extends WithTakes>(
  candidates: T,
  voice: string,
  take: { key: string; spoken: string },
): T {
  if (take.spoken !== candidates.audition.spoken) return candidates
  return { ...candidates, takes: { ...candidates.takes, [voice]: take.key } }
}
