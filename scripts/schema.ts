/** Writes `schema/content-studio.schema.json` from ProjectSchema: `bun run schema`. */
import { join } from 'node:path'
import { projectJsonSchema } from '../src/core/projectSchema'

await Bun.write(join(import.meta.dir, '../schema/content-studio.schema.json'), projectJsonSchema())
