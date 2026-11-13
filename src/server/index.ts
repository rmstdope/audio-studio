import type { Encoder } from '../services/audio'
import { type ElevenLabsClient } from '../services/elevenlabs'
import { type FishClient } from '../services/fish'
import { type MusicGenerator } from '../services/music'
import { type EffectGenerator } from '../services/effects'
import { type ImageGenerator } from '../services/images'
import { type Transcriber } from '../services/transcriber'
import index from '../ui/index.html'
import { allowedHosts, notFound } from './shared'
import { createContext } from './context'
import { effectsRoutes } from './routes/effects'
import { imagesRoutes } from './routes/images'
import { musicRoutes } from './routes/music'
import { narrationRoutes } from './routes/narration'
import { scenesRoutes } from './routes/scenes'
import { setupRoutes } from './routes/setup'

/** How to start the studio's server. */
export interface ServerOptions {
  projectFile: string
  /** 0 picks a free port. */
  port: number
  /** Hot reloading and browser console forwarding, for working on the studio itself. */
  development?: boolean
  /** The Fish client to use (tests); by default one is made from the project's API key. */
  fish?: FishClient | null
  /** The clip encoder to use (tests); ffmpeg by default. */
  encode?: Encoder
  /** The take checker to use (tests: null for none); by default a Whisper worker, started on use. */
  transcriber?: Transcriber | null
  /** The music generator to use (tests); by default an ACE-Step worker, started on use. */
  music?: MusicGenerator
  /** The ElevenLabs client to use (tests); by default one is made from the project's API key. */
  elevenlabs?: ElevenLabsClient | null
  /** The image generator to use (tests); by default mflux, or a stand-in when `CONTENT_STUDIO_FAKE_IMAGES=1`. */
  images?: ImageGenerator
  /** The sound effects generator to use (tests); by default the Small SFX worker, or a stand-in when `CONTENT_STUDIO_FAKE_EFFECTS=1`. */
  effects?: EffectGenerator
}

export { allowedHosts }

/**
 * The studio's local server: the UI, and a JSON API over the project. It listens on 127.0.0.1
 * only, reads the project from disk on every request, so edits show up on reload, and takes
 * changes only from its own page.
 *
 * The API answers only requests addressed to 127.0.0.1 or localhost on its port, so a web page
 * whose host name was made to point at this machine (DNS rebinding) cannot read the project.
 */
export function startServer(options: ServerOptions) {
  const { port, development = false } = options
  const context = createContext(options)
  const { guard } = context

  const routes = {
    '/': index,
    ...setupRoutes(context),
    ...narrationRoutes(context),
    ...musicRoutes(context),
    ...imagesRoutes(context),
    ...effectsRoutes(context),
    ...scenesRoutes(context),
    '/api/*': guard(notFound),
  }

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    // Recording a line or a batch of takes can take well over Bun's default 10 s; never cut it off.
    idleTimeout: 0,
    // Cloning a voice sends up to 20 recordings, which pass Bun's default 128 MiB as WAV.
    maxRequestBodySize: 1024 * 1024 * 1024,
    development: development ? { hmr: true, console: true } : false,
    // The route files type a request's address parameters themselves (`RouteRequest`), which
    // Bun can only check against a path written inside this call.
    routes: routes as never,
    fetch: () => new Response('Not found', { status: 404 }),
    error: (error) => {
      console.error(error)
      return Response.json({ error: error.message }, { status: 500 })
    },
  })

  context.listening.port = server.port

  return server
}
