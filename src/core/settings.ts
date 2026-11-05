import { z } from 'zod'
import { CACHE_DIR, FishTierSchema } from './project'

/** Where the person's own settings are kept: in the cache, so they are never committed. */
export const SETTINGS_FILE = `${CACHE_DIR}/settings.json`

/** The person's own settings on this machine, saved from Setup; each absent until chosen. */
export const SettingsSchema = z.object({
  /**
   * What the user has paid Fish in total, which sets how many requests it takes at once (Setup
   * compares it with `parallel`). Absent: not told.
   */
  fishTier: FishTierSchema.optional(),
  /**
   * How long a take fades in and out when played in the studio, in seconds (0: no fade); absent is
   * 0.2. Saved from Setup's Playing takes panel; the game's own file never fades.
   */
  takeFade: z.number().min(0).optional(),
})

/** The person's own settings, as read from the cache. */
export type Settings = z.infer<typeof SettingsSchema>
