import { z } from 'zod'
import { ProjectSchema } from './project'

/** Where the project file's JSON Schema is published: the `$schema` a project file names. */
export const PROJECT_SCHEMA_URL =
  'https://raw.githubusercontent.com/rmstdope/audio-studio/main/schema/content-studio.schema.json'

/**
 * The JSON Schema of the project file, as the text of `schema/content-studio.schema.json`: made
 * from ProjectSchema as a file is written (its input), so a field with a default is optional, for
 * an editor to complete fields and flag mistakes. The studio's own rules beyond the shape (such as
 * `{part}` in a path) are checked when it reads the file. Every object names all its keys
 * (`additionalProperties: false`), so a leftover of an older format is flagged; the studio itself
 * passes over such a key.
 */
export function projectJsonSchema(): string {
  const { $schema, ...rest } = closed(z.toJSONSchema(ProjectSchema, { io: 'input' }))
  const schema = { $schema, $id: PROJECT_SCHEMA_URL, title: 'content-studio.json', ...rest }
  return `${JSON.stringify(schema, null, 2)}\n`
}

/**
 * `node` with every object schema in it that names its keys (`properties`) and says nothing of
 * others made closed to them; a table keyed by any name keeps its own `additionalProperties`.
 */
function closed<T>(node: T): T {
  if (Array.isArray(node)) return node.map(closed) as T
  if (typeof node !== 'object' || node === null) return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) out[key] = closed(value)
  if ('properties' in out && !('additionalProperties' in out)) out.additionalProperties = false
  return out as T
}
