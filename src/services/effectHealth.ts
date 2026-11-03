import { dirname } from 'node:path'
import {
  EFFECT_HEALTH_FILE,
  EffectHealthSchema,
  type EffectFailure,
  type EffectHealth,
} from '../core/effectHealth'
import type { EffectModelId } from '../core/effectModels'
import type { Problem } from '../core/project'
import { readResource, writeAtomic } from './files'
import { createSerial } from './serial'

/** What an effect that failed tells the store: the effects tool's last error line. */
export type EffectFailureReport = Omit<EffectFailure, 'at'>

/** The studio's memory of effect models whose last effect failed, kept in the project's `.content-studio/`. */
export interface EffectHealthStore {
  /** The failed last effects, by model; a model with none is not there. A file that cannot be read says none. */
  read(projectFile: string): Promise<EffectHealth['models']>
  /** Remembers that this model's last effect failed, replacing what was remembered. */
  record(projectFile: string, model: EffectModelId, failure: EffectFailureReport): Promise<void>
  /** Forgets this model's failure, because an effect made with it worked. */
  clear(projectFile: string, model: EffectModelId): Promise<void>
}

/** Creates the store; `now` is the clock (tests). */
export function createEffectHealth({
  now = () => new Date(),
}: { now?: () => Date } = {}): EffectHealthStore {
  const turns = createSerial()
  const load = async (root: string): Promise<EffectHealth['models']> => {
    const problems: Problem[] = []
    const read = await readResource(root, EFFECT_HEALTH_FILE, EffectHealthSchema, problems)
    return read === 'missing' || read === 'invalid' ? {} : read.models
  }
  const change = (projectFile: string, apply: (models: EffectHealth['models']) => boolean) =>
    turns.run(projectFile, async () => {
      const root = dirname(projectFile)
      const models = await load(root)
      if (apply(models))
        await writeAtomic(root, EFFECT_HEALTH_FILE, `${JSON.stringify({ models }, null, 2)}\n`)
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
