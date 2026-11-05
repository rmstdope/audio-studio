import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJsonSchema } from './projectSchema'

const CHECKED_IN = join(import.meta.dir, '../../schema/content-studio.schema.json')

describe('the project file’s JSON Schema', () => {
  it('is checked in as the studio makes it: run `bun run schema` after changing ProjectSchema', () => {
    expect(readFileSync(CHECKED_IN, 'utf8')).toBe(projectJsonSchema())
  })

  it('describes the file as it is written, its defaults optional', () => {
    const schema = JSON.parse(projectJsonSchema()) as {
      $id: string
      title: string
      required: string[]
      properties: Record<string, { const?: unknown }>
    }
    expect(schema.$id).toBe(
      'https://raw.githubusercontent.com/rmstdope/audio-studio/main/schema/content-studio.schema.json',
    )
    expect(schema.title).toBe('content-studio.json')
    expect(schema.properties.version!.const).toBe(2)
    expect(schema.required).toEqual(['version', 'name', 'parts', 'narration'])
  })

  it('allows no key it does not name, so a leftover of version 1 is flagged', () => {
    type Node = { additionalProperties?: unknown; properties?: Record<string, Node> }
    const schema = JSON.parse(projectJsonSchema()) as Node
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties!.takeFade).toBeUndefined()
    const narration = schema.properties!.narration!
    expect(narration.additionalProperties).toBe(false)
    expect(narration.properties!.refreshDialog).toBeUndefined()
    expect(narration.properties!.quality!.additionalProperties).toBe(false)
    expect(schema.properties!.refresh!.additionalProperties).toBe(false)
  })

  it('keeps the schema of a table keyed by any name, such as the words that sound the same per language', () => {
    type Node = { additionalProperties?: unknown; properties?: Record<string, Node> }
    const schema = JSON.parse(projectJsonSchema()) as Node
    const byLanguage =
      schema.properties!.narration!.properties!.quality!.properties!.soundAlikeByLanguage!
    expect(typeof byLanguage.additionalProperties).toBe('object')
  })
})
