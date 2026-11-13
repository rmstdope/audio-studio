import type { Fades } from '../../core/fades'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BriefChange } from '../../core/music'
import type { MusicMakingSummary, MusicTakesView } from '../../core/musicTake'
import { takesAreBeingMade } from '../musicTakesText'
import type {
  MakeAllResult,
  ModelStateResult,
  MusicBatch,
  TrimResult,
} from '../../services/musicTakes'
import type {
  ChooseResult,
  DropResult,
  MakeRequest,
  MakeResult,
  MoveResult,
  StopResult,
} from '../../services/musicTakes'
import type { BriefChangeResult } from '../../services/briefs'
import type { RemoveResult } from '../../services/musicOrphans'
import type { RefreshSharedResult } from '../../services/refresh'
import type { ModelsChange } from '../../services/models'
import type { ProjectFailure } from '../../services/workspace'

import { useBatch, useMakeAllRequest, useStopAllRequest, type MakeAllMedium } from './batchHooks'
import { getJson, useRefreshRun } from './core'
import { useTakeAction, type TakeMedium } from './takeHooks'

/**
 * Saves the project's music model in the project file (`was` is the one the page showed), then
 * reloads everything that shows it: the Models panel, the takes' menus and the setup checks.
 */
export function useSetMusicModel() {
  const client = useQueryClient()
  return useMutation({
    scope: { id: 'models' },
    mutationFn: async ({ model, was }: { model: string; was: string }) => {
      const response = await fetch('/api/music/model', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, was }),
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`saving the music model answered ${response.status}`)
      }
      return (await response.json()) as ModelsChange
    },
    onSettled: () => client.invalidateQueries(),
  })
}

/** Refreshing the stingers with the project's `refresh.shared`: see `useRefreshRun`. */
export function useRefreshShared() {
  return useRefreshRun<RefreshSharedResult>(
    ['refresh-shared'],
    '/api/music/stingers/refresh',
    (client) => client.invalidateQueries({ queryKey: ['project'] }),
  )
}

/**
 * Saves one field of a track's brief, length, tempo or key (the studio's change over the game's),
 * then reloads the project, whose Music pages show the result.
 */
export function useSetTrackBrief(trackId: string) {
  const client = useQueryClient()
  return useMutation({
    scope: { id: `brief-${trackId}` },
    mutationFn: async (change: BriefChange) => {
      const response = await fetch(`/api/music/tracks/${encodeURIComponent(trackId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(change),
      })
      if (response.status === 404) {
        throw new Error('The game no longer lists this track; the page shows it as it is now.')
      }
      if (!response.ok && response.status !== 409) {
        throw new Error(`saving the brief answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<BriefChangeResult>
    },
    // Saved or not (a 404 means the list changed), the page shows the project as it is now.
    onSettled: () => client.invalidateQueries({ queryKey: ['project'] }),
  })
}

/**
 * Keep mine on a track whose brief the game changed: the studio's brief stays, now over the
 * game's, then reloads the project. Shares the brief's scope, so it waits for a save in flight.
 */
export function useKeepMyBrief(trackId: string) {
  const client = useQueryClient()
  return useMutation({
    scope: { id: `brief-${trackId}` },
    mutationFn: async () => {
      const response = await fetch(`/api/music/tracks/${encodeURIComponent(trackId)}/keep-mine`, {
        method: 'POST',
      })
      if (response.status === 404) {
        throw new Error('The game no longer lists this track; the page shows it as it is now.')
      }
      if (!response.ok && response.status !== 409) {
        throw new Error(`keeping the brief answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<BriefChangeResult>
    },
    onSettled: () => client.invalidateQueries({ queryKey: ['project'] }),
  })
}

/** Where music keeps its tracks' takes' queries, for the hooks every medium with takes shares. */
const musicTakeMedium: TakeMedium = {
  base: (id) => `/api/music/tracks/${encodeURIComponent(id)}`,
  takesKey: 'music-takes',
  makingKey: 'music-making',
}

/** A track's takes as its page shows them; polled while any is being made. */
export function useMusicTakes(trackId: string) {
  return useQuery({
    queryKey: ['music-takes', trackId],
    queryFn: () =>
      getJson<MusicTakesView | ProjectFailure>(
        `/api/music/tracks/${encodeURIComponent(trackId)}/takes`,
      ),
    refetchInterval: (query) => {
      const view = query.state.data
      return view && 'making' in view && takesAreBeingMade(view.making) ? 3000 : false
    },
  })
}

/** Asks for takes of a track (new ones, or a failed one again), then reloads its takes. */
export function useMakeTakes(trackId: string) {
  return useTakeAction<MakeRequest, NonNullable<MakeResult>>(
    musicTakeMedium,
    trackId,
    (a) => a.make,
  )
}

/**
 * Takes a track's chosen take back (its music file is deleted from the game), then reloads its
 * takes and the project, whose Music pages show the track's status.
 */
export function useUnchooseTake(trackId: string) {
  return useTakeAction<void, NonNullable<ChooseResult>>(musicTakeMedium, trackId, (a) => a.unchoose)
}

/**
 * Accepts what changed of a track since its take was chosen (its brief, tempo or key): the take is
 * kept and counts as made from them. Reloads the project, whose Music pages show the status, and
 * the track's takes.
 */
export function useAcceptTrackChange(trackId: string) {
  return useTakeAction<void, NonNullable<ChooseResult>>(musicTakeMedium, trackId, (a) => a.accept)
}

/** Takes a take off a track's board, then reloads its takes. */
export function useDropTake(trackId: string) {
  return useTakeAction<string, NonNullable<DropResult>>(musicTakeMedium, trackId, (a) => a.drop)
}

/**
 * Saves a stinger take's fades, or removes them (null), then reloads the track's takes. When the
 * take is the chosen one, the game's file is written again at once.
 */
export function useSetFades(trackId: string) {
  return useTakeAction<{ file: string; fades: Fades | null }, NonNullable<DropResult>>(
    musicTakeMedium,
    trackId,
    (a) => a.fades,
  )
}

/**
 * Moves a take of this track to another track, then reloads both tracks' takes, the project (the
 * lists' status) and what is being made.
 */
export function useMoveTake(trackId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (request: { file: string; to: string }) => {
      const response = await fetch(`/api/music/tracks/${encodeURIComponent(trackId)}/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`moving the take answered ${response.status}`)
      }
      return (await response.json()) as MoveResult
    },
    onSettled: (_answer, _error, request) =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['project'] }),
        client.invalidateQueries({ queryKey: ['music-takes', trackId] }),
        client.invalidateQueries({ queryKey: ['music-takes', request.to] }),
        client.invalidateQueries({ queryKey: ['music-making'] }),
      ]),
  })
}

/**
 * Makes a take the track's music, then reloads its takes and the project, whose Music pages show
 * the track's status.
 */
export function useChooseTake(trackId: string) {
  return useTakeAction<string, NonNullable<ChooseResult>>(musicTakeMedium, trackId, (a) => a.choose)
}

/**
 * Trims a stinger take's near-silence (or, with `undo`, gives the take back as generated), then
 * reloads the track's takes and the project, since the take in the game may have been rewritten.
 */
export function useTrimTake(trackId: string) {
  return useTakeAction<{ file: string; undo: boolean }, NonNullable<TrimResult>>(
    musicTakeMedium,
    trackId,
    (a) => a.trim,
  )
}

/**
 * Removes the music of a track the game no longer asks for, then reloads the project, whose
 * Music pages no longer show it.
 */
export function useRemoveOrphan(trackId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/music/tracks/${encodeURIComponent(trackId)}/remove`, {
        method: 'POST',
      })
      if (!response.ok && response.status !== 409 && response.status !== 404) {
        throw new Error(`removing the music answered ${response.status}`)
      }
      return response.status === 404
        ? ({
            ok: false,
            message: 'The game asks for this track again, or it is already gone.',
          } as const)
        : ((await response.json()) as NonNullable<RemoveResult>)
    },
    onSettled: () => client.invalidateQueries({ queryKey: ['project'] }),
  })
}

/** Stops a track's takes (the one being made and those waiting), then reloads its takes. */
export function useStopTakes(trackId: string) {
  return useTakeAction<void, NonNullable<StopResult>>(musicTakeMedium, trackId, (a) => a.stop)
}

/** What is being made for each track of the project, for the lists' status; polled meanwhile. */
export function useMusicMaking() {
  return useQuery({
    queryKey: ['music-making'],
    queryFn: () => getJson<Record<string, MusicMakingSummary>>('/api/music/making'),
    refetchInterval: (query) =>
      Object.values(query.state.data ?? {}).some((making) => making.takes > 0) ? 3000 : false,
  })
}

/** The project's music model and whether takes can be made with it now. */
export function useMusicModelState() {
  return useQuery({
    queryKey: ['music-model-state'],
    queryFn: () => getJson<NonNullable<ModelStateResult>>('/api/music/model-state'),
  })
}

/**
 * What one press of Make takes on a list remembers (the studio keeps it, so every tab and a
 * reload see it): how many takes it asked for, for which tracks, how many of each track's takes
 * had failed before it, how many of its takes were stopped (by Stop all or on a track's page), and
 * whether any is still going.
 */
export type MakeAllBatch = MusicBatch

/** Where Make all keeps its press and its requests for one list. */
const makeAllMedium = (listId: string): MakeAllMedium => ({
  base: `/api/music/lists/${encodeURIComponent(listId)}`,
  batchKey: ['music-batch', listId],
  makingKey: ['music-making'],
  stop: 'stop',
  tolerated: [],
})

/**
 * A list's latest press of Make takes, or null, and `dismiss` (Close), which clears it for every
 * tab. `busy` says that takes are being made in the list.
 */
export function useMakeAllBatch(
  listId: string,
  busy = false,
): {
  batch: MakeAllBatch | null
  dismiss: () => void
} {
  const { batch, close } = useBatch<MakeAllBatch>(makeAllMedium(listId), busy)
  return { batch, dismiss: close }
}

/**
 * Asks for four takes of every track with no chosen take on a list. The studio plans again and
 * remembers the press; the page reads what is being made and the press afterwards.
 */
export function useMakeAll(listId: string) {
  return useMakeAllRequest<void, MakeAllResult>(
    makeAllMedium(listId),
    () => undefined,
    (answer) => {
      if (!answer.ok || answer.takes === 0) throw new Error('asking for takes made nothing')
    },
  )
}

/** Stops every take of a list that waits or is being made; the studio counts them into the press. */
export function useStopAll(listId: string) {
  return useStopAllRequest<{ ok: true; byTrack: Record<string, number> }>(makeAllMedium(listId))
}
