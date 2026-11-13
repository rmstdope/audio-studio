import { describe, expect, it } from 'bun:test'
import { fileRoute, type RouteRequest } from './shared'

describe('fileRoute', () => {
  const guard = <R extends Request>(handler: (request: R) => Response | Promise<Response>) =>
    handler
  const request = Object.assign(new Request('http://x/'), { params: {} }) as unknown as RouteRequest

  it('serves the file its finder names', async () => {
    const response = await fileRoute(guard, async () => import.meta.path)(request)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('fileRoute')
  })

  it('answers 404 when the finder names none', async () => {
    expect((await fileRoute(guard, async () => null)(request)).status).toBe(404)
  })
})
