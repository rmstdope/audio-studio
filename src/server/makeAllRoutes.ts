import type { ZodType } from 'zod'
import type { RouteContext } from './context'
import { notFound, type RouteRequest } from './shared'

/** What a service answers: nothing when the thing is not there, else a result that may refuse. */
type Answer = { ok?: boolean } | null | undefined

/**
 * The Make all actions a medium's service offers under the same names, each reading what it needs
 * (an act or list id, the body) from the request, so one set of routes serves every medium.
 */
export type MakeAllService<Body = undefined> = {
  makeAll(projectFile: string, request: RouteRequest, body: Body): Promise<Answer>
  batch(projectFile: string, request: RouteRequest): Promise<unknown>
  closeBatch(projectFile: string, request: RouteRequest): Promise<unknown>
  stopAll(projectFile: string, request: RouteRequest): Promise<Answer>
}

/** One medium's Make all routes: where they live, its service and the body Make all accepts. */
export type MakeAllRoutesMedium<Body> = {
  /** The address before `/make-all`, such as `/api/effects` or `/api/music/lists/:id`. */
  base: string
  /** The last part of Stop all's address: `stop` or `stop-all`. */
  stop: string
  service: MakeAllService<Body>
  /** The body Make all needs, when it needs one (the effects' ids). */
  body?: ZodType<Body>
  /** Whether a refused Stop all answers 409 (images); otherwise any result is a 200 (music, effects). */
  stopRefuses?: boolean
  /** What the 400 says the body should have been, such as `{ ids }`. */
  expected?: string
}

/** The answer for a result that may refuse: 404 for nothing, 409 for a refusal, else 200. */
function answerOf(result: Answer): Response {
  if (!result) return notFound()
  return Response.json(result, { status: result.ok === false ? 409 : 200 })
}

/**
 * The routes of Make all (make, its batch, close, stop all), declared once and instantiated per
 * medium. A change to Make all is made here.
 */
export function makeAllRoutes<Body = undefined>(
  c: Pick<RouteContext, 'fromOwnPage' | 'guard' | 'projectFile'>,
  { base, stop, service, body, expected, stopRefuses = false }: MakeAllRoutesMedium<Body>,
) {
  const { fromOwnPage, guard, projectFile } = c
  return {
    [`${base}/make-all`]: {
      POST: fromOwnPage(async (request: RouteRequest) => {
        let parsed: Body = undefined as Body
        if (body) {
          const result = body.safeParse(await request.json().catch(() => null))
          if (!result.success) {
            return Response.json({ error: `expected ${expected ?? 'a body'}` }, { status: 400 })
          }
          parsed = result.data
        }
        return answerOf(await service.makeAll(projectFile, request, parsed))
      }),
    },
    [`${base}/batch`]: {
      GET: guard(async (request: RouteRequest) =>
        Response.json(await service.batch(projectFile, request)),
      ),
    },
    [`${base}/batch/close`]: {
      POST: fromOwnPage(async (request: RouteRequest) =>
        Response.json(await service.closeBatch(projectFile, request)),
      ),
    },
    [`${base}/${stop}`]: {
      POST: fromOwnPage(async (request: RouteRequest) => {
        const result = await service.stopAll(projectFile, request)
        return stopRefuses ? answerOf(result) : result ? Response.json(result) : notFound()
      }),
    },
  }
}
