import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import type { CandidatesResult, CharacterChange } from '../services/auditions'
import type { AuditionTakesResult, TakeResult } from '../services/takes'
import { withAuditionTakes, withTake } from './takes'
import type { AdoptResult, LoadResult, PartResult } from '../services/workspace'

/** A successful candidates answer. */
type Found = Extract<NonNullable<CandidatesResult>, { ok: true }>

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`${path} answered ${response.status}`)
  return (await response.json()) as T
}

/** POSTs to `path`. A 409 is an answer (the request was refused for a reason given in the body). */
async function postJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { method: 'POST' })
  if (!response.ok && response.status !== 409)
    throw new Error(`${path} answered ${response.status}`)
  return (await response.json()) as T
}

/** The project summary, or the problems with the project file. Refetched when the window regains focus. */
export function useProject() {
  return useQuery({ queryKey: ['project'], queryFn: () => getJson<LoadResult>('/api/project') })
}

/** A part with the state of every line's clip. */
export function usePart(partId: string, enabled = true) {
  return useQuery({
    queryKey: ['part', partId],
    queryFn: () => getJson<NonNullable<PartResult>>(`/api/parts/${encodeURIComponent(partId)}`),
    enabled,
  })
}

/** Adopts a part's untracked clips, then reloads the part. */
export function useAdopt(partId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () =>
      postJson<NonNullable<AdoptResult>>(`/api/parts/${encodeURIComponent(partId)}/adopt`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['part', partId] }),
  })
}

/** Voices found for a character's audition. Cached for a while: each search asks Fish many times. */
export function useCandidates(characterId: string) {
  return useQuery({
    queryKey: ['candidates', characterId],
    queryFn: () =>
      getJson<NonNullable<CandidatesResult>>(
        `/api/characters/${encodeURIComponent(characterId)}/candidates`,
      ),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

/**
 * Saves a character's audition keywords, then searches again with them. Saves for one character
 * run one after another, so a quick second edit is never overtaken by the first.
 */
export function useSetKeywords(characterId: string) {
  const client = useQueryClient()
  return useMutation({
    scope: { id: `keywords-${characterId}` },
    mutationFn: async (keywords: string[]) => {
      const response = await fetch(`/api/characters/${encodeURIComponent(characterId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keywords }),
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`saving the keywords answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<CharacterChange>
    },
    // Stay pending until the project (which holds the saved keywords) is reloaded, so the chips
    // never fall back to the old list; the search reruns on its own time.
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['candidates', characterId] })
      return client.invalidateQueries({ queryKey: ['project'] })
    },
  })
}

/** Saves a character's own audition phrase (null for the standard one), then reloads its takes. */
export function useSetPhrase(characterId: string) {
  const client = useQueryClient()
  return useMutation({
    scope: { id: `phrase-${characterId}` },
    mutationFn: async (phrase: string | null) => {
      const response = await fetch(`/api/characters/${encodeURIComponent(characterId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phrase }),
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`saving the phrase answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<CharacterChange>
    },
    // Refresh the phrase and takes shown, without searching Fish's library again.
    onSuccess: async (saved) => {
      if (!saved.ok) return
      const key = ['candidates', characterId]
      const shown = client.getQueryData<NonNullable<CandidatesResult>>(key)
      if (!shown?.ok) return client.invalidateQueries({ queryKey: key })
      const voices = [shown.current?.id, ...shown.candidates.map((c) => c.voice.id)]
      const query = encodeURIComponent(voices.filter(Boolean).join(','))
      const fresh = await getJson<NonNullable<AuditionTakesResult>>(
        `/api/characters/${encodeURIComponent(characterId)}/audition?voices=${query}`,
      ).catch(() => null)
      if (!fresh?.ok) return client.invalidateQueries({ queryKey: key })
      client.setQueryData<NonNullable<CandidatesResult>>(key, (old) =>
        old?.ok ? withAuditionTakes<Found>(old, fresh.audition, fresh.takes) : old,
      )
    },
  })
}

/**
 * Records audition takes: `record(voice)` asks the server for the take and adds it to the
 * candidates in the cache, without searching Fish again. `recording` holds the voices in progress,
 * `errors` what went wrong per voice.
 */
export function useTakes(characterId: string) {
  const client = useQueryClient()
  const [recording, setRecording] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})

  const record = useCallback(
    async (voice: string) => {
      setRecording((now) => new Set(now).add(voice))
      setErrors(({ [voice]: _gone, ...rest }) => rest)
      try {
        const response = await fetch(`/api/characters/${encodeURIComponent(characterId)}/takes`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ voice }),
        })
        if (!response.ok && response.status !== 409) {
          throw new Error(`recording answered ${response.status}`)
        }
        const result = (await response.json()) as NonNullable<TakeResult>
        if (result.ok) {
          client.setQueryData<NonNullable<CandidatesResult>>(['candidates', characterId], (old) =>
            old?.ok ? withTake<Found>(old, voice, result) : old,
          )
        } else {
          const message = 'message' in result ? result.message : 'the project’s files need fixing'
          setErrors((now) => ({ ...now, [voice]: message }))
        }
      } catch (error) {
        setErrors((now) => ({
          ...now,
          [voice]: error instanceof Error ? error.message : String(error),
        }))
      } finally {
        setRecording((now) => {
          const next = new Set(now)
          next.delete(voice)
          return next
        })
      }
    },
    [characterId, client],
  )

  return { record, recording, errors }
}

/** The URL of a recorded audition take. */
export function takeUrl(key: string): string {
  return `/api/takes/${key}.mp3`
}

/** The URL of a clip in a part. */
export function clipUrl(partId: string, file: string): string {
  return `/api/parts/${encodeURIComponent(partId)}/clips/${encodeURIComponent(file)}`
}
