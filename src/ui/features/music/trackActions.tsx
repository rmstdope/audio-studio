import { createContext, useContext, useMemo, useState } from 'react'

/**
 * Which red failure line a track's page may show: only the one of the action pressed last. Each
 * action has a key (`choose:3`, `trim:1`, `unchoose` …); pressing one makes it the newest, and a
 * line shows while its key is.
 */
export type TrackActions = {
  /** Whether the failure line of the action with this key is the newest, so may be shown. */
  shows: (key: string) => boolean
  /** The user pressed the action with this key: every older line goes. */
  press: (key: string) => void
}

/** Without a track page around it (a card on its own) every line shows and pressing changes nothing. */
const alone: TrackActions = { shows: () => true, press: () => {} }

/** The track page's {@link TrackActions}, for the cards and editors below it. */
export const TrackActionsContext = createContext<TrackActions>(alone)

/** The {@link TrackActions} of the page around the caller. */
export function useTrackActions(): TrackActions {
  return useContext(TrackActionsContext)
}

/** Holds a track page's last pressed action; the state lives and dies with the page. */
export function useTrackActionsState(): TrackActions {
  const [last, setLast] = useState<string | null>(null)
  return useMemo(() => ({ shows: (key) => key === last, press: setLast }), [last])
}
