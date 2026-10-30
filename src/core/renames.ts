/** Which of the studio's old and new names a game's folder holds. */
export interface FoundNames {
  /** `audio-studio.json` is there. */
  oldFile: boolean
  /** `content-studio.json` is there. */
  newFile: boolean
  /** `.audio-studio/` is there, beside the project file. */
  oldFolder: boolean
}

const LEAD = 'This game is set up for Audio Studio, which is now Content Studio.'
const RENAME_FILE = '  git mv audio-studio.json content-studio.json'
const RENAME_FOLDER = '  mv .audio-studio .content-studio'
const RENAME_GITIGNORE = '  in .gitignore, change .audio-studio/ to .content-studio/'

/**
 * What the terminal says when a game still has the studio's old names: exactly the renames left to
 * do, or the both-files message. Null when there is nothing old to rename. The studio never reads
 * the old names; the person renames them and runs `content-studio` again.
 */
export function renameNotice({ oldFile, newFile, oldFolder }: FoundNames): string | null {
  if (oldFile && newFile) {
    return [
      'This game has both audio-studio.json and content-studio.json.',
      'Keep one, named content-studio.json, then run content-studio again.',
    ].join('\n')
  }
  const steps = [
    ...(oldFile ? [RENAME_FILE] : []),
    ...(oldFolder ? [RENAME_FOLDER, RENAME_GITIGNORE] : []),
  ]
  if (steps.length === 0) return null
  const ask = oldFile && !oldFolder ? 'Rename this' : 'Rename these'
  return [LEAD, `${ask}, then run content-studio again:`, ...steps].join('\n')
}

/** What the terminal says when no project file is found from `cwd` upwards. */
export function noProjectMessage(cwd: string): string {
  return (
    `No content-studio.json in ${cwd} or any folder above it.\n` +
    'Run content-studio from the game repository that has one, or pass --project <file>.'
  )
}
