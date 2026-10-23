import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdoptResult, LoadResult, PartResult } from '../services/workspace'

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

/** The URL of a clip in a part. */
export function clipUrl(partId: string, file: string): string {
  return `/api/parts/${encodeURIComponent(partId)}/clips/${encodeURIComponent(file)}`
}
