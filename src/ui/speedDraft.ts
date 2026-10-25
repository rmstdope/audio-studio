import { SPEED } from '../core/resources'

/** What a typed speed means: a speed to save (null: the project's), or why it cannot be saved. */
export type SpeedDraft =
  { ok: true; speed: number | null; changed: boolean } | { ok: false; message: string }

/**
 * Reads the speed typed on a character's page: empty means the project's speed (null); otherwise a
 * number from half to double, as Fish speaks. `current` is the character's saved speed, to say
 * whether anything changed.
 */
export function speedDraft(typed: string, current: number | null): SpeedDraft {
  const text = typed.trim()
  if (!text) return { ok: true, speed: null, changed: current !== null }
  const speed = Number(text)
  if (!Number.isFinite(speed) || speed < SPEED.min || speed > SPEED.max) {
    return {
      ok: false,
      message: `A speed is a number from ${SPEED.min} (half) to ${SPEED.max} (double).`,
    }
  }
  return { ok: true, speed, changed: speed !== current }
}
