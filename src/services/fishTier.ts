import type { FishTier } from '../core/setup'
import { changeSetting, type SettingsChange } from './settings'

/** A saved Fish tier, or why it was not saved. */
export type FishTierChange = SettingsChange

/**
 * Saves what the user has paid Fish in total (`fishTier` in the person's settings, in the cache),
 * or clears it with `null`. The project file is never written.
 */
export function setFishTier(projectFile: string, tier: FishTier | null): Promise<FishTierChange> {
  return changeSetting(projectFile, 'fishTier', tier ?? undefined)
}
