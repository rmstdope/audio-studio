import { z } from 'zod'
import { ProjectSchema } from './project'

/** Where the project file's JSON Schema is published: the `$schema` a project file names. */
export const PROJECT_SCHEMA_URL =
  'https://raw.githubusercontent.com/rmstdope/audio-studio/main/schema/content-studio.schema.json'

/**
 * The JSON Schema of the project file, as the text of `schema/content-studio.schema.json`: made
 * from ProjectSchema as a file is written (its input), so a field with a default is optional, for
 * an editor to complete fields and flag mistakes. The studio's own rules beyond the shape (such as
 * `{part}` in a path) are checked when it reads the file.
 */
export function projectJsonSchema(): string {
  const { $schema, ...rest } = z.toJSONSchema(ProjectSchema, { io: 'input' })
  const schema = { $schema, $id: PROJECT_SCHEMA_URL, title: 'content-studio.json', ...rest }
  return `${JSON.stringify(schema, null, 2)}\n`
}
