import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SceneMix } from '../../core/scenes'
import type { SceneSave } from '../../services/scenes'
import { useEffect, useRef } from 'react'

import { getJson } from './core'

/**
 * Saves one scene of an act into the act's mix file. A refusal (409) comes back as the answer, not
 * an error; a saved scene loads the project again before the answer is returned, so the page
 * shows the saved scene when it lets go of its draft.
 */
export function useSaveScene(partId: string) {
  const client = useQueryClient()
  return useMutation({
    scope: { id: `scene-${partId}` },
    mutationFn: async (change: {
      sceneId: string
      scene: SceneMix
      was: SceneMix | null
      moved?: { db: number; measuredAt: string }
    }) => {
      const response = await fetch(
        `/api/scenes/${encodeURIComponent(partId)}/${encodeURIComponent(change.sceneId)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scene: change.scene, was: change.was, moved: change.moved }),
        },
      )
      if (!response.ok && response.status !== 409) {
        throw new Error(`saving the scene answered ${response.status}`)
      }
      return (await response.json()) as SceneSave
    },
    onSuccess: async (answer) => {
      if (answer.ok) await client.invalidateQueries({ queryKey: ['project'] })
    },
  })
}

/** How far the measure of each act's scenes has got: scenes done out of all, by act. */
export type SceneLoudnessMaking = Record<string, { done: number; total: number }>

/**
 * Measuring the loudness of an act's scenes (§8.11). `running` is how far the act's measure has
 * got (null: none is running), kept up by asking the studio once a second while any is, so it is
 * still there coming back to the page. The project is read again as each scene finishes, so its
 * figures appear as they are made. `start` presses Measure loudness, with the open scene as the
 * page has it when that has unsaved changes.
 */
export function useSceneLoudness(partId: string) {
  const client = useQueryClient()
  const making = useQuery({
    queryKey: ['scene-loudness'],
    queryFn: () => getJson<SceneLoudnessMaking>('/api/scene-loudness'),
    refetchInterval: (query) => (Object.keys(query.state.data ?? {}).length > 0 ? 1000 : false),
  })
  const start = useMutation({
    mutationFn: async (open: { scene: string; entry: SceneMix } | null): Promise<string | null> => {
      const response = await fetch(`/api/scene-loudness/${encodeURIComponent(partId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(open ? { open } : {}),
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`measuring the scenes answered ${response.status}`)
      }
      if (response.ok) return null
      return ((await response.json()) as { message?: string }).message ?? 'The studio refused.'
    },
    // A run can end before the first look at how far it has got: read the figures either way.
    onSettled: async () => {
      await client.refetchQueries({ queryKey: ['scene-loudness'] })
      await client.invalidateQueries({ queryKey: ['project'] })
    },
  })
  const running = making.data?.[partId] ?? null
  const done = running?.done
  // Each scene that finishes brings its figures.
  useEffect(() => {
    if (done !== undefined) void client.invalidateQueries({ queryKey: ['project'] })
  }, [client, done])
  // The last one too: the run is gone from the studio's list once it has ended.
  const was = useRef(false)
  useEffect(() => {
    if (was.current && !running) void client.invalidateQueries({ queryKey: ['project'] })
    was.current = running !== null
  }, [client, running])
  return { running, start: start.mutate, refused: start.data ?? null }
}
