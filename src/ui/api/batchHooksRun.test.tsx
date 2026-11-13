import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { MakeAllMedium } from './batchHooks'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { useBatch, useMakeAllRequest, useStopAllRequest } = await import('./batchHooks')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const realFetch = globalThis.fetch
afterAll(() => {
  globalThis.fetch = realFetch
  GlobalRegistrator.unregister()
})

const medium: MakeAllMedium = {
  base: '/api/things/a',
  batchKey: ['batch', 'a'],
  makingKey: ['making'],
  stop: 'stop',
  tolerated: [],
  alsoStale: [['project']],
}

/** Renders the hooks once and hands back what they returned, the requests and the invalidated keys. */
async function run(answer: { status: number; body: unknown }) {
  const requests: { url: string; method: string }[] = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method ?? 'GET' })
    return Response.json(url.endsWith('/batch') ? null : answer.body, { status: answer.status })
  }) as unknown as typeof fetch
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidated: unknown[] = []
  const original = client.invalidateQueries.bind(client)
  client.invalidateQueries = ((filters: { queryKey?: unknown }) => {
    invalidated.push(filters.queryKey)
    return original(filters as never)
  }) as typeof client.invalidateQueries
  let hooks!: {
    batch: ReturnType<typeof useBatch>
    make: ReturnType<typeof useMakeAllRequest<void, { ok: boolean }>>
    stop: ReturnType<typeof useStopAllRequest<unknown>>
  }
  function Probe() {
    hooks = {
      batch: useBatch(medium, false),
      make: useMakeAllRequest<void, { ok: boolean }>(
        medium,
        () => undefined,
        (a) => {
          if (!a.ok) throw new Error('nothing made')
        },
      ),
      stop: useStopAllRequest<unknown>(medium),
    }
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(Probe)))
  })
  return { hooks: () => hooks, requests, invalidated, root }
}

describe('the Make all hooks', () => {
  it('post Make all and Stop all to the medium and read what they changed again', async () => {
    const r = await run({ status: 200, body: { ok: true } })
    await act(async () => {
      await r.hooks().make.mutateAsync()
      await r.hooks().stop.mutateAsync()
    })
    expect(r.requests.filter((q) => q.method === 'POST').map((q) => q.url)).toEqual([
      '/api/things/a/make-all',
      '/api/things/a/stop',
    ])
    for (const key of [['making'], ['batch', 'a'], ['project']]) {
      expect(r.invalidated).toContainEqual(key)
    }
    await act(async () => r.root.unmount())
  })

  it('throw when the check says nothing was made, and when the status is not tolerated', async () => {
    const nothing = await run({ status: 200, body: { ok: false } })
    await act(async () => {
      await expect(nothing.hooks().make.mutateAsync()).rejects.toThrow('nothing made')
    })
    const refused = await run({ status: 409, body: { ok: false } })
    await act(async () => {
      await expect(refused.hooks().stop.mutateAsync()).rejects.toThrow(
        'stopping the takes answered 409',
      )
    })
  })

  it('close clears the batch through the medium’s own address', async () => {
    const r = await run({ status: 200, body: { ok: true } })
    await act(async () => {
      r.hooks().batch.close()
      await new Promise((done) => setTimeout(done, 20))
    })
    expect(r.requests).toContainEqual({ url: '/api/things/a/batch/close', method: 'POST' })
  })
})
