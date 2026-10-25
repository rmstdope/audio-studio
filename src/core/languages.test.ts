import { describe, expect, it } from 'bun:test'
import { knownLanguage, languageName } from './languages'

describe('languageName', () => {
  it('names a language in itself, capitalised', () => {
    expect(languageName('en')).toBe('English')
    expect(languageName('sv')).toBe('Svenska')
    expect(languageName('de')).toBe('Deutsch')
    expect(languageName('fr')).toBe('Français')
  })
})

describe('knownLanguage', () => {
  it('accepts language codes and refuses anything else', () => {
    expect(knownLanguage('sv')).toBe(true)
    expect(knownLanguage('pt-BR')).toBe(true)
    expect(knownLanguage('Swedish')).toBe(false)
    expect(knownLanguage('')).toBe(false)
    expect(knownLanguage('a/b')).toBe(false)
  })
})
