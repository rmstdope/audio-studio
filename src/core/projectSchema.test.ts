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
})
