import { afterAll, describe, expect, it } from 'bun:test'
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { tempRepo } from '../../../../test/helpers'
import { loadPart, loadProject } from '../../../services/workspace'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { CastSection } = await import('./PartOverview')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

describe('the cast on a part’s overview', () => {
  it.each([
    ['cannot be read', 'invalid', (file: string) => writeFileSync(file, '[not json')],
    ['is not there', 'missing', (file: string) => rmSync(file)],
  ] as const)(
    'never calls a character’s lines up to date while the language’s dialog %s',
    async (_, status, breakDialog) => {
      const root = tempRepo({})
      cpSync(join(import.meta.dir, '../../../../test/fixtures/sample'), root, { recursive: true })
      breakDialog(join(root, 'tts/act1/sv/script.json'))
      // Both speakers cast in Svenska, as when the bug was seen, so a card would show how lines stand.
      const castFile = join(root, 'tts/cast.json')
      const cast = JSON.parse(readFileSync(castFile, 'utf8')) as {
        speakers: Record<string, Record<string, unknown>>
      }
      for (const [id, speaker] of Object.entries(cast.speakers))
        speaker.languages = { sv: { voice: `sv-${id}`, voiceName: `Svensk ${id}` } }
      writeFileSync(castFile, JSON.stringify(cast, null, 2))
      const file = join(root, 'audio-studio.json')
      const project = await loadProject(file)
      const part = await loadPart(file, 'act1', 'sv')
      if (!project.ok || !part?.ok) throw new Error('the sample did not load')
      expect(part.part.dialog).toBe(status)

      const container = document.createElement('div')
      document.body.append(container)
      const view = createRoot(container)
      act(() =>
        view.render(
          createElement(CastSection, {
            summary: project.summary,
            part: project.summary.parts.find((p) => p.id === 'act1')!,
            detail: part.part,
            language: 'sv',
          }),
        ),
      )

      const cards = [...container.querySelectorAll('article.card')]
      expect(cards.map((card) => card.getAttribute('aria-label'))).toContain('Keeper')
      for (const card of cards) {
        expect(card.textContent).not.toContain('Ready')
        expect(card.textContent).not.toContain('all up to date')
      }
      act(() => view.unmount())
    },
  )
})
