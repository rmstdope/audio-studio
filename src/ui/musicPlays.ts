import type { CurrentMusic } from '../core/music'

/** Why a press of play failed: the file would not open, or it is gone since the page loaded. */
export type PlayFailure = 'open' | 'gone'

/** What a row's Plays cell says. */
export interface PlaysText {
  /** "Take 3", "The game's file" or "Nothing to play yet". */
  lead: string
  /** The game's file name, in small grey monospace beneath. */
  file?: string
  /** The file's full path as the game's list gives it, for a tooltip. */
  path?: string
  /** Red, beneath the file name: the file was not there when the page loaded. */
  missing?: string
  /** Red, beneath the file name: the last press of play failed. */
  failure?: string
  /** Faint text: there is nothing to play. */
  faint?: true
}

const NOT_THERE = 'The file is not there.'

const FAILURE: Record<PlayFailure, string> = {
  open: "Couldn't play it: the file won't open.",
  gone: "Couldn't play it: the file is not there.",
}

/** The last part of a path: the file's name as the game's list gives it. */
function fileName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}

/** The words of a row's Plays cell. */
export function playsText(current: CurrentMusic, failed?: PlayFailure): PlaysText {
  const text: PlaysText =
    current.kind === 'take'
      ? { lead: `Take ${current.take}` }
      : current.kind === 'game'
        ? { lead: "The game's file", file: fileName(current.file), path: current.file }
        : current.kind === 'unknown'
          ? { lead: 'Not known', faint: true }
          : { lead: 'Nothing to play yet', faint: true }
  if ((current.kind === 'take' || current.kind === 'game') && !current.exists)
    text.missing = NOT_THERE
  if (failed) text.failure = FAILURE[failed]
  return text
}

/** Whether there is music to play: it is named and it is on disk. */
export function canPlay(current: CurrentMusic): boolean {
  return (current.kind === 'take' || current.kind === 'game') && current.exists
}

/**
 * The play button's accessible name: the track and what it plays, or Stop while it plays. Only for
 * a track that can play, since a row with nothing to play has no button.
 */
export function playLabel(title: string, current: CurrentMusic, playing: boolean): string {
  if (playing) return `Stop ${title}`
  return `Play ${title}: ${current.kind === 'take' ? `take ${current.take}` : "the game's file"}`
}
