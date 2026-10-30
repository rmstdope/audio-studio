import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProjectSummary } from '../../../core/summary'
import { tempRepo } from '../../../../test/helpers'
import { startServer } from '../../../server/index'

// The studio itself, on a copy of the sample whose cast is broken as when the bug was seen: a
// voice that is a number.
const root = tempRepo({})
cpSync(join(import.meta.dir, '../../../../test/fixtures/sample'), root, { recursive: true })
const castFile = join(root, 'tts/cast.json')
const cast = JSON.parse(readFileSync(castFile, 'utf8')) as {
  speakers: Record<string, Record<string, unknown>>
}
cast.speakers.narrator!.voice = 42
writeFileSync(castFile, JSON.stringify(cast, null, 2))
const server = startServer({
  projectFile: join(root, 'content-studio.json'),
  port: 0,
  fish: null,
  transcriber: null,
  elevenlabs: null,
})
const realFetch = globalThis.fetch
afterAll(() => server.stop(true))

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
// The studio runs in this process, so it keeps Bun's own fetch classes, not the DOM's.
const { Request, Response, Headers } = globalThis
GlobalRegistrator.register()
Object.assign(globalThis, { Request, Response, Headers })
const { act, createElement, Fragment } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { Problems } = await import('../../components/Problems')
const { LinesView } = await import('./LinesView')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

/** Waits until `ready` holds, letting React and the studio answer meanwhile. */
async function until(ready: () => boolean) {
  for (let i = 0; i < 200 && !ready(); i++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
  }
  expect(ready()).toBe(true)
}

describe('a part’s All lines page, with the cast file broken', () => {
  it('reads each cast-file problem once', async () => {
    globalThis.fetch = ((input: string, init?: RequestInit) =>
      realFetch(new URL(input, server.url), init)) as typeof fetch
    try {
      const project = (await (await fetch('/api/project')).json()) as {
        summary: ProjectSummary
      }
      const { summary } = project
      const part = summary.parts.find((p) => p.id === 'act1')!
      const message = 'speakers.narrator.voice must be text (it is a number)'
      expect(summary.problems.map((p) => p.message)).toContain(message)

      const container = document.createElement('div')
      document.body.append(container)
      const page = createRoot(container)
      // The page as App lays it out: the top banner, then the part's lines.
      await act(() =>
        page.render(
          createElement(
            QueryClientProvider,
            { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
            createElement(
              Fragment,
              null,
              createElement(Problems, {
                title: 'Some files could not be read',
                problems: summary.problems,
              }),
              createElement(LinesView, { summary, part }),
            ),
          ),
        ),
      )
      await until(() => (container.textContent ?? '').includes('Generation cannot be planned'))
      expect((container.textContent ?? '').split(message).length - 1).toBe(1)
      await act(() => page.unmount())
    } finally {
      globalThis.fetch = realFetch
      document.body.innerHTML = ''
    }
  })
})
