import { changeSetting, type SettingsChange } from './settings'

/** A saved take fade, or why it was not saved. */
export type TakeFadeChange = SettingsChange

/**
 * Saves how long takes fade in and out when played in the studio (`takeFade` in the person's
 * settings, in the cache, in seconds, 0 for none). The project file is never written.
 */
export function setTakeFade(projectFile: string, seconds: number): Promise<TakeFadeChange> {
  return changeSetting(projectFile, 'takeFade', seconds)
}
