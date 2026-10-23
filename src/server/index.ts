import { adoptPart, clipFile, loadPart, loadProject } from '../services/workspace'
import index from '../ui/index.html'

/** How to start the studio's server. */
export interface ServerOptions {
  projectFile: string
  /** 0 picks a free port. */
  port: number
  /** Hot reloading and browser console forwarding, for working on the studio itself. */
  development?: boolean
}

const notFound = () => Response.json({ error: 'not found' }, { status: 404 })

/**
 * The studio's local server: the UI, and a JSON API over the project. It listens on 127.0.0.1
 * only, reads the project from disk on every request, so edits show up on reload, and takes
 * changes only from its own page.
 */
export function startServer({ projectFile, port, development = false }: ServerOptions) {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    development: development ? { hmr: true, console: true } : false,
    routes: {
      '/': index,
      '/api/project': {
        GET: async () => Response.json(await loadProject(projectFile)),
      },
      '/api/parts/:part': {
        GET: async (request) => {
          const result = await loadPart(projectFile, request.params.part)
          return result ? Response.json(result) : notFound()
        },
      },
      '/api/parts/:part/adopt': {
        POST: async (request) => {
          if (!fromOwnPage(request)) return forbidden()
          const result = await adoptPart(projectFile, request.params.part)
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        },
      },
      '/api/parts/:part/clips/:file': {
        GET: async (request) => {
          const file = await clipFile(projectFile, request.params.part, request.params.file)
          return file ? new Response(Bun.file(file)) : notFound()
        },
      },
      '/api/*': notFound,
    },
    fetch: () => new Response('Not found', { status: 404 }),
    error: (error) => {
      console.error(error)
      return Response.json({ error: error.message }, { status: 500 })
    },
  })

  /** A browser sends Origin with every POST; only the studio's own page may change files. */
  function fromOwnPage(request: Request): boolean {
    return request.headers.get('origin') === server.url.origin
  }

  return server
}

function forbidden() {
  return Response.json(
    { error: 'changes are only accepted from the studio itself' },
    { status: 403 },
  )
}
