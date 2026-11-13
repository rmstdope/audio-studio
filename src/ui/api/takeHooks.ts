import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Fades } from '../../core/fades'

/** One request to a medium's take routes: its path is relative to the track or effect's address. */
type TakeRequest = { method: string; path: string; body?: unknown }

/** What one take action sends, what its failure says, and the statuses that still carry an answer. */
type TakeAction<V> = {
  what: string
  request: (value: V) => TakeRequest
  tolerated: readonly number[]
}

/**
 * The requests of the take actions every medium with takes has, written once. Paths are relative
 * to the address of one track or effect (`/api/effects/<id>`) and match `takeRoutes` on the server.
 */
export function takeActions() {
  const post = (path: string, body?: unknown): TakeRequest => ({
    method: 'POST',
    path,
    ...(body !== undefined && { body }),
  })
  const refusable = [409] as const
  return {
    make: {
      what: 'asking for takes',
      request: (body: unknown) => post('/takes', body),
      tolerated: refusable,
    },
    stop: { what: 'stopping the takes', request: () => post('/stop'), tolerated: [] },
    choose: {
      what: 'choosing the take',
      request: (name: string) => post('/choose', { file: name }),
      tolerated: refusable,
    },
    fades: {
      what: 'saving the fades',
      request: ({ file: name, fades }: { file: string; fades: Fades | null }): TakeRequest => ({
        method: fades ? 'PUT' : 'DELETE',
        path: `/takes/${encodeURIComponent(name)}/fades`,
        ...(fades && { body: fades }),
      }),
      tolerated: refusable,
    },
    trim: {
      what: 'trimming the take',
      request: (body: { file: string; undo: boolean }) => post('/trim', body),
      tolerated: refusable,
    },
    drop: {
      what: 'dropping the take',
      request: (name: string): TakeRequest => ({
        method: 'DELETE',
        path: `/takes/${encodeURIComponent(name)}`,
      }),
      tolerated: refusable,
    },
    unchoose: {
      what: 'un-choosing the take',
      request: () => post('/unchoose'),
      tolerated: refusable,
    },
    accept: {
      what: 'accepting the change',
      request: () => post('/accept'),
      tolerated: refusable,
    },
  } satisfies Record<string, TakeAction<never>>
}

/** Where a medium keeps its takes' queries: the takes of one track or effect, and what is being made. */
export type TakeMedium = {
  /** The address of one track or effect, given its id. */
  base: (id: string) => string
  takesKey: string
  makingKey: string
}

/**
 * One change to a track or effect's takes, then its takes, the project (whose pages show the
 * status) and what is being made are read again, so a block never shows the old state.
 */
export function useTakeAction<V, R>(
  medium: TakeMedium,
  id: string,
  action: (actions: ReturnType<typeof takeActions>) => TakeAction<V>,
) {
  const client = useQueryClient()
  const base = medium.base(id)
  const { what, request, tolerated } = action(takeActions())
  return useMutation({
    mutationFn: async (value: V) => {
      const { method, path, body } = request(value)
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok && !tolerated.includes(response.status)) {
        throw new Error(`${what} answered ${response.status}`)
      }
      return (await response.json()) as R
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['project'] }),
        client.invalidateQueries({ queryKey: [medium.takesKey, id] }),
        client.invalidateQueries({ queryKey: [medium.makingKey] }),
      ]),
  })
}
