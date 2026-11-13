import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { takeRoutes, type TakeService } from './takeRoutes'
import type { RouteRequest } from './shared'

/** Calls the server's pass-through guards record, and what the fake service was asked. */
function setup(answer: unknown) {
  const calls: unknown[][] = []
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args.slice(1)])
      return answer
    }
  const service = {
    view: record('view'),
    make: record('make'),
    takeFile: async () => null,
    trimmedSound: async () => null,
    drop: record('drop'),
    setFades: record('setFades'),
    choose: record('choose'),
    trim: record('trim'),
    unchoose: record('unchoose'),
    accept: record('accept'),
    stop: record('stop'),
  } as unknown as TakeService<{ count: number }, { in: number }>
  const routes = takeRoutes(
    { projectFile: 'p', guard: (h) => h, fromOwnPage: (h) => h },
    {
      base: '/api/things',
      service,
      bodies: {
        make: z.object({ count: z.number() }),
        fades: z.object({ in: z.number() }),
        choose: z.object({ file: z.string() }),
        trim: z.object({ file: z.string(), undo: z.boolean().optional() }),
      },
    },
  ) as unknown as Record<string, Record<string, (r: RouteRequest) => Promise<Response>>>
  return { routes, calls }
}

const request = (params: Record<string, string>, body?: unknown, url = 'http://x/') =>
  Object.assign(new Request(url, { method: 'POST', body: JSON.stringify(body) }), {
    params,
  }) as unknown as RouteRequest

describe('takeRoutes', () => {
  it('declares each take action once, at the medium’s base', () => {
    expect(Object.keys(setup({ ok: true }).routes)).toEqual([
      '/api/things/:id/takes',
      '/api/things/:id/takes/:file',
      '/api/things/:id/takes/:file/fades',
      '/api/things/:id/choose',
      '/api/things/:id/trim',
      '/api/things/:id/unchoose',
      '/api/things/:id/accept',
      '/api/things/:id/stop',
    ])
  })

  it('answers 400 to a body that does not fit, 404 to nothing, 409 to a refusal, 200 otherwise', async () => {
    const bad = await setup({ ok: true }).routes['/api/things/:id/choose']!.POST!(
      request({ id: 'a' }, {}),
    )
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'expected { file }' })
    const none = await setup(null).routes['/api/things/:id/choose']!.POST!(
      request({ id: 'a' }, { file: 'f.wav' }),
    )
    expect(none.status).toBe(404)
    const refused = await setup({ ok: false, message: 'no' }).routes['/api/things/:id/choose']!
      .POST!(request({ id: 'a' }, { file: 'f.wav' }))
    expect(refused.status).toBe(409)
    const { routes, calls } = setup({ ok: true })
    const done = await routes['/api/things/:id/choose']!.POST!(
      request({ id: 'a' }, { file: 'f.wav' }),
    )
    expect(done.status).toBe(200)
    expect(calls).toEqual([['choose', 'a', 'f.wav']])
  })

  it('passes each action’s arguments to the service', async () => {
    const { routes, calls } = setup({ ok: true })
    await routes['/api/things/:id/takes']!.POST!(request({ id: 'a' }, { count: 2 }))
    await routes['/api/things/:id/takes/:file']!.DELETE!(request({ id: 'a', file: 'f' }))
    await routes['/api/things/:id/takes/:file/fades']!.PUT!(
      request({ id: 'a', file: 'f' }, { in: 1 }),
    )
    await routes['/api/things/:id/takes/:file/fades']!.DELETE!(request({ id: 'a', file: 'f' }))
    await routes['/api/things/:id/trim']!.POST!(request({ id: 'a' }, { file: 'f' }))
    await routes['/api/things/:id/unchoose']!.POST!(request({ id: 'a' }))
    await routes['/api/things/:id/accept']!.POST!(request({ id: 'a' }))
    expect(calls).toEqual([
      ['make', 'a', { count: 2 }],
      ['drop', 'a', 'f'],
      ['setFades', 'a', 'f', { in: 1 }],
      ['setFades', 'a', 'f', null],
      ['trim', 'a', 'f', false],
      ['unchoose', 'a'],
      ['accept', 'a'],
    ])
  })

  it('answers a stop with the result, and 404 for nothing', async () => {
    const stopped = await setup({ ok: true, stopped: 1 }).routes['/api/things/:id/stop']!.POST!(
      request({ id: 'a' }),
    )
    expect(await stopped.json()).toEqual({ ok: true, stopped: 1 })
    expect(
      (await setup(null).routes['/api/things/:id/stop']!.POST!(request({ id: 'a' }))).status,
    ).toBe(404)
  })

  it('reads a take list, and 404s a missing one', async () => {
    expect(
      (await setup({ takes: [] }).routes['/api/things/:id/takes']!.GET!(request({ id: 'a' })))
        .status,
    ).toBe(200)
    expect(
      (await setup(null).routes['/api/things/:id/takes']!.GET!(request({ id: 'a' }))).status,
    ).toBe(404)
  })

  it('names what a bad body should have been, for make, fades and trim', async () => {
    const { routes } = setup({ ok: true })
    const make = await routes['/api/things/:id/takes']!.POST!(request({ id: 'a' }, {}))
    expect([make.status, await make.json()]).toEqual([
      400,
      { error: 'expected { count } or { retry }' },
    ])
    const fades = await routes['/api/things/:id/takes/:file/fades']!.PUT!(
      request({ id: 'a', file: 'f' }, {}),
    )
    expect(await fades.json()).toEqual({ error: 'expected { in, out, shape }' })
    const trim = await routes['/api/things/:id/trim']!.POST!(request({ id: 'a' }, {}))
    expect(await trim.json()).toEqual({ error: 'expected { file, undo? }' })
  })

  it('serves a take’s file, 404 when it is not there, from any medium’s base', async () => {
    const { routes } = setup({ ok: true })
    const missing = await routes['/api/things/:id/takes/:file']!.GET!(
      request({ id: 'a', file: 'f' }),
    )
    expect(missing.status).toBe(404)
    const other = setup({ ok: true })
    expect(Object.keys(other.routes)[0]).toBe('/api/things/:id/takes')
  })
})
