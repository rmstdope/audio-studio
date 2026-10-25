/** The shortest recording Fish makes a voice from, in seconds. */
export const MIN_SECONDS = 10

/** The most recordings Fish takes for one voice. */
export const MAX_FILES = 20

/** A chosen file: its name, and its length in seconds, or null when it could not be read as audio. */
export interface Recording {
  name: string
  seconds: number | null
}

/** What happens to a chosen file: it is sent, or it is left out for being short or not audio. */
export type Mark = 'sent' | 'short' | 'not-audio'

/** What the form shows and allows for the files and fields chosen so far. */
export interface CloneState {
  /** One mark per chosen file, in order. */
  marks: Mark[]
  /** The positions of the files that will be sent. */
  sendable: number[]
  /** The line saying what will be sent, or null when nothing will be. */
  total: string | null
  /** The line explaining why cloning is blocked by the files, or null. */
  note: string | null
  /** Whether Clone voice is enabled. */
  canClone: boolean
}

/** A length in seconds as people say it: `45 s`, `1 min 25 s`, `2 min`. */
export function formatLength(seconds: number): string {
  const whole = Math.round(seconds)
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  if (minutes === 0) return `${rest} s`
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`
}

/**
 * Judges the chosen files and fields: which files are sent, what to tell the user about them,
 * and whether the voice can be made. Needs a name, the permission tick, at least one recording
 * of `MIN_SECONDS` and no more than `MAX_FILES` files in all.
 */
export function cloneState({
  files,
  name,
  permitted,
}: {
  files: Recording[]
  name: string
  permitted: boolean
}): CloneState {
  const marks = files.map((f): Mark =>
    f.seconds === null ? 'not-audio' : f.seconds < MIN_SECONDS ? 'short' : 'sent',
  )
  const sendable = marks.flatMap((m, i) => (m === 'sent' ? [i] : []))
  const seconds = sendable.reduce((sum, i) => sum + (files[i]?.seconds ?? 0), 0)
  const tooMany = files.length - MAX_FILES
  const word = (n: number) => `${n} recording${n === 1 ? '' : 's'}`
  let note: string | null = null
  if (tooMany > 0) {
    note = `${files.length} recordings chosen; Fish takes up to ${MAX_FILES}. Remove ${tooMany} to clone.`
  } else if (files.length > 0 && sendable.length === 0) {
    note = `No recording is long enough. Each needs at least ${MIN_SECONDS} seconds of speech.`
  }
  return {
    marks,
    sendable,
    total:
      sendable.length > 0
        ? `${word(sendable.length)} will be sent · ${formatLength(seconds)} in all.`
        : null,
    note,
    canClone: note === null && sendable.length > 0 && name.trim() !== '' && permitted,
  }
}
