import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { LanguageSwitch } from './LanguageSwitch'

const tabs = [
  { id: 'sv', name: 'Svenska', count: '3/3', title: '3 of 3 lines up to date', dimmed: false },
  {
    id: 'de',
    name: 'Deutsch',
    count: 'No dialog',
    title: 'Act I has no Deutsch dialog yet',
    dimmed: true,
  },
]

describe('LanguageSwitch', () => {
  const html = renderToStaticMarkup(<LanguageSwitch tabs={tabs} active="sv" onChoose={() => {}} />)

  it('gives a dimmed tab the studio tip, not a browser tooltip, and keeps it pressable', () => {
    const de = html.match(/<button[^>]*data-language="de"[^>]*>/)![0]
    expect(de).toContain('data-why="Act I has no Deutsch dialog yet"')
    expect(de).not.toContain('title=')
    expect(de).not.toContain('aria-disabled')
  })

  it('keeps the browser title on a tab that is not dimmed', () => {
    const sv = html.match(/<button[^>]*data-language="sv"[^>]*>/)![0]
    expect(sv).toContain('title="3 of 3 lines up to date"')
    expect(sv).not.toContain('data-why')
  })
})
