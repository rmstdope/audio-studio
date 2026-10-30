import { dirname } from 'node:path'
import {
  IMAGE_HEALTH_FILE,
  ImageHealthSchema,
  type ImageFailure,
  type ImageHealth,
} from '../core/imageHealth'
import type { ImageModelId } from '../core/imageModels'
import type { Problem } from '../core/project'
import { readResource, writeAtomic } from './files'
import { createSerial } from './serial'

/** What a take that failed tells the store: the image and take, and the image tool's last error line. */
export type ImageFailureReport = Omit<ImageFailure, 'at'>

/** The studio's memory of image models whose last take failed, kept in the project's `.content-studio/`. */
export interface ImageHealthStore {
  /** The failed last takes, by model; a model with none is not there. A file that cannot be read says none. */
  read(projectFile: string): Promise<ImageHealth['models']>
  /** Remembers that this model's last take failed, replacing what was remembered. */
  record(projectFile: string, model: ImageModelId, failure: ImageFailureReport): Promise<void>
  /** Forgets this model's failure, because a take with it worked. */
  clear(projectFile: string, model: ImageModelId): Promise<void>
}

/** Creates the store; `now` is the clock (tests). */
export function createImageHealth({
  now = () => new Date(),
}: { now?: () => Date } = {}): ImageHealthStore {
  const turns = createSerial()
  const load = async (root: string): Promise<ImageHealth['models']> => {
    const problems: Problem[] = []
    const read = await readResource(root, IMAGE_HEALTH_FILE, ImageHealthSchema, problems)
    return read === 'missing' || read === 'invalid' ? {} : read.models
  }
  const change = (projectFile: string, apply: (models: ImageHealth['models']) => boolean) =>
    turns.run(projectFile, async () => {
      const root = dirname(projectFile)
      const models = await load(root)
      if (apply(models))
        await writeAtomic(root, IMAGE_HEALTH_FILE, `${JSON.stringify({ models }, null, 2)}\n`)
    })
  return {
    read: (projectFile) => turns.run(projectFile, () => load(dirname(projectFile))),
    record: (projectFile, model, failure) =>
      change(projectFile, (models) => {
        models[model] = { ...failure, at: now().toISOString() }
        return true
      }),
    clear: (projectFile, model) =>
      change(projectFile, (models) => {
        if (!models[model]) return false
        delete models[model]
        return true
      }),
  }
}
