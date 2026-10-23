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

/**
 * The candidates with the audition phrase and takes from a fresh lookup. When the phrase is the
 * one already shown, takes recorded since the lookup was read are kept too.
 */
export function withAuditionTakes<T extends WithTakes>(
  candidates: T,
  audition: T['audition'],
  takes: Record<string, string>,
): T {
  const same = audition.spoken === candidates.audition.spoken
  return { ...candidates, audition, takes: same ? { ...takes, ...candidates.takes } : takes }
}
