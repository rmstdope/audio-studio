import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { makeAllRoutes, type MakeAllService } from './makeAllRoutes'
import type { RouteRequest } from './shared'

/** A service whose every action answers `answer` and records what it was asked. */
function setup(answer: unknown, stop = 'stop') {
  const calls: unknown[][] = []
  const record =
    (name: string) =>
    async (_file: string, request: RouteRequest, ...rest: unknown[]) => {
      calls.push([name, request.params.id, ...rest])
      return answer
    }
  const service = {
    makeAll: record('makeAll'),
    batch: record('batch'),
    closeBatch: record('closeBatch'),
    stopAll: record('stopAll'),
  } as unknown as MakeAllService<{ ids: string[] }>
  const routes = makeAllRoutes(
    { projectFile: 'p', guard: (h) => h, fromOwnPage: (h) => h },
    { base: '/api/things/:id', stop, service, body: z.object({ ids: z.array(z.string()) }) },
  ) as unknown as Record<string, Record<string, (r: RouteRequest) => Promise<Response>>>
  return { routes, calls }
}

const request = (params: Record<string, string>, body?: unknown) =>
  Object.assign(new Request('http://x/', { method: 'POST', body: JSON.stringify(body) }), {
    params,
  }) as unknown as RouteRequest

describe('makeAllRoutes', () => {
  it('declares Make all, its batch, Close and Stop all once, at the medium’s base', () => {
    expect(Object.keys(setup({ ok: true }).routes)).toEqual([
      '/api/things/:id/make-all',
      '/api/things/:id/batch',
      '/api/things/:id/batch/close',
      '/api/things/:id/stop',
    ])
    expect(Object.keys(setup({ ok: true }, 'stop-all').routes).at(-1)).toBe(
      '/api/things/:id/stop-all',
    )
  })

  it('answers 400 to a body that does not fit, 404 to nothing, 409 to a refusal, else 200', async () => {
    const make = (answer: unknown, body: unknown) =>
      setup(answer).routes['/api/things/:id/make-all']!.POST!(request({ id: 'a' }, body))
    expect((await make({ ok: true }, {})).status).toBe(400)
    expect((await make(null, { ids: [] })).status).toBe(404)
    expect((await make({ ok: false }, { ids: [] })).status).toBe(409)
    expect((await make({ ok: true }, { ids: ['x'] })).status).toBe(200)
  })

  it('passes the request and body to the service, and answers batch and Close as they are', async () => {
    const { routes, calls } = setup({ running: false })
    await routes['/api/things/:id/make-all']!.POST!(request({ id: 'a' }, { ids: ['x'] }))
    const batch = await routes['/api/things/:id/batch']!.GET!(request({ id: 'a' }))
    expect(await batch.json()).toEqual({ running: false })
    await routes['/api/things/:id/batch/close']!.POST!(request({ id: 'a' }))
    await routes['/api/things/:id/stop']!.POST!(request({ id: 'a' }))
    expect(calls.map((c) => c[0])).toEqual(['makeAll', 'batch', 'closeBatch', 'stopAll'])
    expect(calls[0]).toEqual(['makeAll', 'a', { ids: ['x'] }])
  })
})
