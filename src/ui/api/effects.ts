import type { Fades } from '../../core/fades'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RefreshEffectsResult } from '../../services/refresh'
import type { EffectEditResult } from '../../services/effectWords'
import type { EffectMakingSummary, EffectModelsView, EffectTakesView } from '../../core/effectTakes'
import type { EffectBatch } from '../../core/effectsMakeAll'
import type {
  EffectChooseResult,
  EffectTrimResult,
  EffectMakeAllResult,
  EffectMakeResult,
  EffectStopResult,
  MakeEffectRequest,
} from '../../services/effectTakes'
import { useEffect, useRef } from 'react'
import type { ModelsChange } from '../../services/models'
import type { ProjectFailure } from '../../services/workspace'

import { closeKept, getJson, useRefreshRun } from './core'
import { useTakeAction, type TakeMedium } from './takeHooks'

/**
 * Saves the project's sound-effects model in the project file (`was` is the one the page showed), then
 * reloads everything that shows it: the Models panel, an effect's Takes section and the checks.
 */
export function useSetEffectModel() {
  const client = useQueryClient()
  return useMutation({
    scope: { id: 'models' },
    mutationFn: async ({ model, was }: { model: string; was: string }) => {
      const response = await fetch('/api/effect-model', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, was }),
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`saving the sound-effects model answered ${response.status}`)
      }
      return (await response.json()) as ModelsChange
    },
    onSettled: () => client.invalidateQueries(),
  })
}

/** Refreshing the sound effects with the project's `refresh.shared`: see `useRefreshRun`. */
export function useRefreshEffects() {
  return useRefreshRun<RefreshEffectsResult>(
    ['refresh-effects'],
    '/api/effects/refresh',
    (client) => client.invalidateQueries({ queryKey: ['project'] }),
  )
}

/**
 * Sends one change to the studio's own sound effect descriptions, then reloads the project, whose
 * Sound effects pages show the result. A 404 means the game does not list the effect (any more).
 */
function useEffectEdit<V>(
  id: string,
  request: (value: V) => { method: string; path: string; body?: unknown },
) {
  const client = useQueryClient()
  return useMutation({
    scope: { id: `effect-${id}` },
    mutationFn: async (value: V) => {
      const { method, path, body } = request(value)
      const response = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (response.status === 404) {
        throw new Error(
          'The game no longer lists this sound effect; the page shows it as it is now.',
        )
      }
      if (!response.ok && response.status !== 409) {
        throw new Error(`saving the description answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<EffectEditResult>
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['project'] }),
        // A failed take is shown only for the description it was made from.
        client.invalidateQueries({ queryKey: ['effect-takes', id] }),
      ]),
  })
}

/** Saves the studio's description of a sound effect; null takes the game's back. */
export function useSetEffectDescription(id: string) {
  return useEffectEdit<string | null>(id, (description) => ({
    method: 'PATCH',
    path: `/api/effects/${encodeURIComponent(id)}`,
    body: { description },
  }))
}

/** Keep mine: the studio's description stays when the game rewords the effect. */
export function useKeepMineEffect(id: string) {
  return useEffectEdit<void>(id, () => ({
    method: 'POST',
    path: `/api/effects/${encodeURIComponent(id)}/keep-mine`,
  }))
}

/** Forget: deletes the studio's description of an effect the game no longer lists. */
export function useForgetEffect(id: string) {
  return useEffectEdit<void>(id, () => ({
    method: 'POST',
    path: `/api/effects/${encodeURIComponent(id)}/forget`,
  }))
}

/** A sound effect's takes as its page shows them; polled while any is being made. */
export function useEffectTakes(id: string) {
  return useQuery({
    queryKey: ['effect-takes', id],
    queryFn: () =>
      getJson<EffectTakesView | ProjectFailure>(`/api/effects/${encodeURIComponent(id)}/takes`),
    refetchInterval: (query) => {
      const view = query.state.data
      return view && 'making' in view && view.making.length > 0 ? 1000 : false
    },
  })
}

/** Where sound effects keep their takes' queries, for the hooks every medium with takes shares. */
const effectTakeMedium: TakeMedium = {
  base: (id) => `/api/effects/${encodeURIComponent(id)}`,
  takesKey: 'effect-takes',
  makingKey: 'effects-making',
}

/** Asks for takes of a sound effect (new ones, or a failed one again). */
export function useMakeEffectTakes(id: string) {
  return useTakeAction<MakeEffectRequest, NonNullable<EffectMakeResult>>(
    effectTakeMedium,
    id,
    (a) => a.make,
  )
}

/** Stops a sound effect's takes (the one being made and those waiting). */
export function useStopEffectTakes(id: string) {
  return useTakeAction<void, NonNullable<EffectStopResult>>(effectTakeMedium, id, (a) => a.stop)
}

/** Makes a take the sound effect's clip in the game. */
export function useChooseEffectTake(id: string) {
  return useTakeAction<string, NonNullable<EffectChooseResult>>(
    effectTakeMedium,
    id,
    (a) => a.choose,
  )
}

/**
 * Saves a one-shot sound effect take's fades, or removes them (null). When the take is the chosen
 * one, the game's file is written again at once.
 */
export function useSetEffectFades(id: string) {
  return useTakeAction<{ file: string; fades: Fades | null }, NonNullable<EffectMakeResult>>(
    effectTakeMedium,
    id,
    (a) => a.fades,
  )
}

/** Cuts the near-silence of a one-shot sound effect take, or (with `undo`) gives the take back as generated. */
export function useTrimEffectTake(id: string) {
  return useTakeAction<{ file: string; undo: boolean }, NonNullable<EffectTrimResult>>(
    effectTakeMedium,
    id,
    (a) => a.trim,
  )
}

/** Takes a take off a sound effect's board. */
export function useDropEffectTake(id: string) {
  return useTakeAction<string, NonNullable<EffectMakeResult>>(effectTakeMedium, id, (a) => a.drop)
}

/** Takes the chosen take back: its clip is deleted from the game. */
export function useUnchooseEffect(id: string) {
  return useTakeAction<void, NonNullable<EffectChooseResult>>(
    effectTakeMedium,
    id,
    (a) => a.unchoose,
  )
}

/** Accepts a changed description: the chosen take counts as made from it. */
export function useAcceptEffect(id: string) {
  return useTakeAction<void, NonNullable<EffectChooseResult>>(effectTakeMedium, id, (a) => a.accept)
}

/** Which sound-effects models can run, for the Sound effects page's Make all question. */
export function useEffectModels() {
  return useQuery({
    queryKey: ['effect-models'],
    queryFn: () => getJson<EffectModelsView | ProjectFailure>('/api/effects/models'),
  })
}

/**
 * What the latest Make all made, stopped and failed so far, kept by the studio so any tab sees it
 * (null: none, or it was closed). Polled while takes are made, and while a finished one shows so a
 * Close in another tab arrives. `close` clears it for every tab.
 */
export function useEffectsBatch(running: boolean): {
  batch: EffectBatch | null
  close: () => void
} {
  const client = useQueryClient()
  const { data } = useQuery({
    queryKey: ['effects-batch'],
    queryFn: () => getJson<EffectBatch | null>('/api/effects/batch'),
    // Until the batch itself says it is done, so the answer that ends it is never missed.
    refetchInterval: (query) =>
      running || query.state.data?.running ? 1000 : query.state.data ? 5000 : false,
  })
  return {
    batch: data ?? null,
    close: () => closeKept(client, ['effects-batch'], '/api/effects/batch/close'),
  }
}

/** One change that reaches every effect (Make all, Stop all), then everything it changes is read again. */
function useEffectsAll<V, R>(path: string, what: string, bodyOf: (value: V) => unknown) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (value: V) => {
      const body = bodyOf(value)
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok && response.status !== 409)
        throw new Error(`${what} answered ${response.status}`)
      return (await response.json()) as R
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['project'] }),
        client.invalidateQueries({ queryKey: ['effects-making'] }),
        client.invalidateQueries({ queryKey: ['effects-batch'] }),
        client.invalidateQueries({ queryKey: ['effect-takes'] }),
      ]),
  })
}

/** Makes four takes for each of these sound effects. */
export function useMakeAllEffects() {
  return useEffectsAll<string[], EffectMakeAllResult>(
    '/api/effects/make-all',
    'making the takes',
    (ids) => ({ ids }),
  )
}

/** Stops every sound-effect take waiting or being made. */
export function useStopAllEffects() {
  return useEffectsAll<void, NonNullable<EffectStopResult>>(
    '/api/effects/stop-all',
    'stopping the takes',
    () => undefined,
  )
}

/** What is being made for each sound effect, for the list's status; polled meanwhile. */
export function useEffectsMaking() {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['effects-making'],
    queryFn: () => getJson<Record<string, EffectMakingSummary>>('/api/effects/making'),
    refetchInterval: (query) => (Object.keys(query.state.data ?? {}).length ? 1000 : false),
  })
  // A batch that has just ended changed the effects' statuses: read the project again.
  const busy = Object.keys(query.data ?? {}).length > 0
  const was = useRef(false)
  useEffect(() => {
    if (was.current && !busy) void client.invalidateQueries({ queryKey: ['project'] })
    was.current = busy
  }, [busy, client])
  return query
}
