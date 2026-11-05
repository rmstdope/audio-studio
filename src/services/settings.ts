import { dirname } from 'node:path'
import { problemsFrom, type Problem } from '../core/project'
import { SETTINGS_FILE, SettingsSchema, type Settings } from '../core/settings'
import { readResource, writeAtomic, writeFailure } from './files'
import { createSerial } from './serial'
import { openProject } from './projectFile'
import type { ProjectFailure } from './workspace'

/** A saved setting, or why it was not saved. */
export type SettingsChange = { ok: true } | { ok: false; problems: Problem[] } | ProjectFailure

/** One change of the settings file at a time, so two saves never lose each other's change. */
const settingsWrites = createSerial()

/**
 * The person's settings in the project at `root`: none chosen when there is no file yet, and none
 * when it is broken, with what is wrong added to `problems`.
 */
export async function readSettings(root: string, problems: Problem[]): Promise<Settings> {
  const read = await readResource(root, SETTINGS_FILE, SettingsSchema, problems)
  return read === 'missing' || read === 'invalid' ? {} : read
}

/**
 * Changes one setting (`key`) of the project's settings file to `value`, or removes it with
 * undefined, keeping the others. Refused, and nothing written, for a project file or a settings
 * file that cannot be read and for a value the settings cannot hold; a write the disk refuses is
 * answered with why.
 */
export function changeSetting<K extends keyof Settings>(
  projectFile: string,
  key: K,
  value: Settings[K] | undefined,
): Promise<SettingsChange> {
  const root = dirname(projectFile)
  return settingsWrites.run(root, async () => {
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const problems: Problem[] = []
    const read = await readResource(root, SETTINGS_FILE, SettingsSchema, problems)
    if (read === 'invalid') return { ok: false, problems }
    const settings: Record<string, unknown> = { ...(read === 'missing' ? {} : read) }
    if (value === undefined) delete settings[key]
    else settings[key] = value
    const parsed = SettingsSchema.safeParse(settings)
    if (!parsed.success) return { ok: false, problems: problemsFrom(SETTINGS_FILE, parsed.error) }
    try {
      await writeAtomic(root, SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`)
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        problems: [{ file: SETTINGS_FILE, path: key, message: writeFailure(error) }],
      }
    }
  })
}
