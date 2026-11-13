import { useMutation, useQueryClient } from '@tanstack/react-query'
import { closeKept, useKeptBatch } from './core'
import { sendTake, type TakeAction } from './takeHooks'

/** Where a medium keeps Make all: its address, the queries it makes stale and how often it is read. */
export type MakeAllMedium = {
  /** The address before `/make-all`: `/api/effects`, or one list's or act's. */
  base: string
  /** The query holding the latest press. */
  batchKey: readonly unknown[]
  /** The query holding what is being made. */
  makingKey: readonly unknown[]
  /** The last part of Stop all's address, as `makeAllRoutes` declares it. */
  stop: 'stop' | 'stop-all'
  /** Statuses of Make all and Stop all that still carry an answer (the effects' refusal); others throw. */
  tolerated: readonly number[]
  /** Queries besides the making and the batch that a press or a stop changes. */
  alsoStale?: readonly (readonly unknown[])[]
  /** How often the batch is read while it runs (default 3000). */
  runningMs?: number
}

/** The requests of Make all and Stop all (which share `tolerated`), written once; they match `makeAllRoutes` on the server. */
export function makeAllActions(stop: MakeAllMedium['stop'], tolerated: readonly number[]) {
  return {
    make: {
      what: 'asking for takes',
      request: (body?: unknown) => ({
        method: 'POST',
        path: '/make-all',
        ...(body !== undefined && { body }),
      }),
      tolerated,
    },
    stop: {
      what: 'stopping the takes',
      request: () => ({ method: 'POST', path: `/${stop}` }),
      tolerated,
    },
  } satisfies Record<string, TakeAction<never>>
}

/** What a press or a stop makes stale: the project when listed, what is being made, the batch. */
const staleKeys = (medium: MakeAllMedium) => [
  medium.makingKey,
  medium.batchKey,
  ...(medium.alsoStale ?? []),
]

/**
 * The latest press of Make all, or null, and `close`, which clears it for every tab. `busy` says
 * that takes are being made.
 */
export function useBatch<T extends { running: boolean }>(medium: MakeAllMedium, busy: boolean) {
  const client = useQueryClient()
  const batch = useKeptBatch<T>(medium.batchKey, `${medium.base}/batch`, busy, medium.runningMs)
  return {
    batch,
    close: () => closeKept(client, medium.batchKey, `${medium.base}/batch/close`),
  }
}

/**
 * Make all, then what it changes is read again. `check` may throw on an answer that made nothing;
 * what is being made is read before the mutation settles so the page never shows a gap.
 */
export function useMakeAllRequest<V, R>(
  medium: MakeAllMedium,
  bodyOf: (value: V) => unknown,
  check: (answer: R) => void = () => undefined,
) {
  const client = useQueryClient()
  const { make } = makeAllActions(medium.stop, medium.tolerated)
  return useMutation({
    mutationFn: async (value: V) => {
      const answer = await sendTake<unknown, R>(medium.base, make, bodyOf(value))
      check(answer)
      await client.refetchQueries({ queryKey: medium.makingKey })
      return answer
    },
    onSettled: () =>
      Promise.all(staleKeys(medium).map((queryKey) => client.invalidateQueries({ queryKey }))),
  })
}

/** Stop all, then what it changes is read again. */
export function useStopAllRequest<R>(medium: MakeAllMedium) {
  const client = useQueryClient()
  const { stop } = makeAllActions(medium.stop, medium.tolerated)
  return useMutation({
    mutationFn: () => sendTake<void, R>(medium.base, stop, undefined),
    onSettled: () =>
      Promise.all(staleKeys(medium).map((queryKey) => client.invalidateQueries({ queryKey }))),
  })
}
