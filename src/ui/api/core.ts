import {
  useIsMutating,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type MutationState,
  type QueryClient,
} from '@tanstack/react-query'
import type { ImageMakingSummary } from '../../core/imageTakes'
import { type Figures } from '../../core/takeTimes'
import { useEffect, useRef } from 'react'

/** Reads a JSON answer of the studio's API, throwing when the answer is not a success. */
export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`${path} answered ${response.status}`)
  return (await response.json()) as T
}

/** POSTs to `path`. A 409 is an answer (the request was refused for a reason given in the body). */
export async function postJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { method: 'POST' })
  if (!response.ok && response.status !== 409)
    throw new Error(`${path} answered ${response.status}`)
  return (await response.json()) as T
}

/**
 * A refresh command run from the page: `start` posts to `url`, `pending` says whether it runs,
 * `outcome` is the last one's result until dismissed. The state lives in the mutation cache under
 * `mutationKey`, so leaving the page and coming back during a refresh still shows it running.
 * `reload` loads again what the refresh may have changed.
 */
export function useRefreshRun<R>(
  mutationKey: string[],
  url: string,
  reload: (client: QueryClient) => Promise<unknown>,
) {
  const client = useQueryClient()
  const mutation = useMutation({
    mutationKey,
    scope: { id: `refresh\0${mutationKey.join('\0')}` },
    mutationFn: async () => {
      const response = await fetch(url, { method: 'POST' })
      if (!response.ok && response.status !== 409) {
        throw new Error(`refreshing answered ${response.status}`)
      }
      return (await response.json()) as R
    },
    onSettled: () => reload(client),
  })
  const pending = useIsMutating({ mutationKey }) > 0
  const last = useMutationState({
    filters: { mutationKey },
    select: (m) => m.state as MutationState<R, Error>,
  }).at(-1)
  const settled = last && last.status !== 'pending' && last.status !== 'idle'
  return {
    start: () => mutation.mutate(),
    pending,
    outcome: settled ? { result: last.data ?? null, error: last.error?.message ?? null } : null,
    // Closing forgets the finished refreshes, so the outcome does not come back on a later visit.
    dismiss: () => {
      const cache = client.getMutationCache()
      for (const done of cache.findAll({ mutationKey })) {
        if (done.state.status !== 'pending') cache.remove(done)
      }
    },
  }
}

/**
 * Close: reads already under way are dropped, the summary goes at once, and the studio is told;
 * the query is read again afterwards so a read that raced the Close cannot bring it back.
 */
export function closeKept(client: QueryClient, key: readonly unknown[], path: string) {
  void client.cancelQueries({ queryKey: key }).then(() => {
    client.setQueryData(key, null)
    void fetch(path, { method: 'POST' }).finally(() => client.invalidateQueries({ queryKey: key }))
  })
}

/**
 * Keeps a batch query fresh: polled while the press runs or anything is being made, again every
 * few seconds while a finished one shows (a Close in another tab arrives), and read once more
 * when the last take ends. `runningMs` is how often it is read while the press runs.
 */
export function useKeptBatch<T extends { running: boolean }>(
  key: readonly unknown[],
  path: string,
  busy: boolean,
  runningMs = 3000,
): T | null {
  const client = useQueryClient()
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => getJson<T | null>(path),
    refetchInterval: (query) =>
      busy || query.state.data?.running ? runningMs : query.state.data ? 5000 : false,
  })
  // The key is rebuilt on every render; its text is what identifies the query.
  const id = JSON.stringify(key)
  const was = useRef(busy)
  useEffect(() => {
    if (was.current && !busy) void client.invalidateQueries({ queryKey: JSON.parse(id) })
    was.current = busy
  }, [busy, client, id])
  return data ?? null
}

/**
 * The time each image model takes for a take on this computer (a guess until one is timed); read
 * again while takes are being made, so the next menu drawn after a finished take is new.
 */
export function useTakeTimes() {
  const client = useQueryClient()
  return useQuery({
    queryKey: ['image-take-times'],
    queryFn: () => getJson<Figures>('/api/images/take-times'),
    refetchInterval: () =>
      Object.values(
        client.getQueryData<Record<string, ImageMakingSummary>>(['image-making']) ?? {},
      ).some((m) => m.takes > 0)
        ? 3000
        : false,
  })
}

/** A POST to the remake route of an image that answers nothing the page needs, then reloads its patches. */
export function useRemakeChange(imageId: string, what: 'stop' | 'close') {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/images/${encodeURIComponent(imageId)}/patches/remake/${what}`,
        { method: 'POST' },
      )
      if (!response.ok) throw new Error(`${what} answered ${response.status}`)
    },
    onSettled: () => client.invalidateQueries({ queryKey: ['image-patches', imageId] }),
  })
}
