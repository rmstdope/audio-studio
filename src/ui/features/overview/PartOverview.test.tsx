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
const { CastSection, StatusPanel } = await import('./PartOverview')

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
      const castFile = join(root, 'content-studio/narration/cast.json')
      const cast = JSON.parse(readFileSync(castFile, 'utf8')) as {
        speakers: Record<string, Record<string, unknown>>
      }
      for (const [id, speaker] of Object.entries(cast.speakers))
        speaker.languages = { sv: { voice: `sv-${id}`, voiceName: `Svensk ${id}` } }
      writeFileSync(castFile, JSON.stringify(cast, null, 2))
      const file = join(root, 'content-studio.json')
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

describe('the lines up to date on a part’s overview', () => {
  const panel = (statuses: string[], language?: string) => {
    const counts = {
      ok: 0,
      weak: 0,
      stale: 0,
      missing: 0,
      untracked: 0,
      uncast: 0,
      untranslated: 0,
    }
    for (const s of statuses) counts[s as keyof typeof counts]++
    const part = {
      id: 'act1',
      counts,
      lines: statuses.map((status, i) => ({ key: `l${i}`, status, reasons: [] })),
      orphans: [],
    }
    const container = document.createElement('div')
    document.body.append(container)
    const view = createRoot(container)
    act(() => view.render(createElement(StatusPanel, { part: part as never, language })))
    return { container, done: () => act(() => view.unmount()) }
  }

  it('links to the act’s lines, which open on those that need attention', () => {
    const { container, done } = panel(['ok', 'missing', 'stale'], 'sv')
    const stat = container.querySelector<HTMLAnchorElement>('a.stat-lead')!
    expect(stat.getAttribute('href')).toBe('#/parts/act1/lines?language=sv')
    expect(stat.textContent).toBe('33%Lines up to date1 / 32 need attention ›')
    done()
  })

  it('counts every other status in a chip, with its dot', () => {
    const { container, done } = panel(['ok', 'missing', 'stale', 'stale'])
    const chips = [...container.querySelectorAll('.status-chip')].map((c) => c.textContent)
    expect(chips).toEqual(['Stale 2', 'Missing 1'])
    done()
  })

  it('is no link when every line is up to date', () => {
    const { container, done } = panel(['ok', 'ok'])
    expect(container.querySelector('a.stat-lead')).toBeNull()
    expect(container.querySelector('.stat-lead')?.textContent).toBe('100%Lines up to date2 / 2')
    done()
  })
})
