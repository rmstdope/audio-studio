import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import type { Problem } from '../core/project'
import type { Budget } from '../core/spend'
import {
  needsVersion2,
  SpendingSchema,
  type MusicSpend,
  type Outcome,
  type Recording,
  type Running,
} from '../core/spending'
import { readResource, writeAtomic } from './files'
import { createSerial } from './serial'

/** Where paid recordings are remembered, in the project's tool state. */
export const SPENDING_FILE = '.audio-studio/spending.json'

/** What the record holds (a version 1 record has no music takes), or what is wrong with the file. */
export type SpendingRead =
  { ok: true; recordings: Recording[]; music: MusicSpend[] } | { ok: false; problems: Problem[] }

/** Changes to the record, one at a time. */
const writes = createSerial()

/** The paid recordings and music takes so far, oldest first; none if nothing was spent yet. */
export async function readSpending(projectFile: string): Promise<SpendingRead> {
  const problems: Problem[] = []
  const read = await readResource(dirname(projectFile), SPENDING_FILE, SpendingSchema, problems)
  if (read === 'missing') return { ok: true, recordings: [], music: [] }
  if (read === 'invalid') return { ok: false, problems }
  return { ok: true, recordings: read.recordings, music: read.version === 2 ? read.music : [] }
}

/**
 * Adds to the record what `add` makes of it, written as version 1 while it holds Fish
 * recordings alone (which an older studio reads), else as version 2. A damaged record is left as
 * it is (the user may want to repair it) and its problems given instead.
 */
function appendTo(
  projectFile: string,
  add: (read: { recordings: Recording[]; music: MusicSpend[] }) => {
    recordings: Recording[]
    music: MusicSpend[]
  },
): Promise<SpendingRead> {
  return writes.run(projectFile, async () => {
    const before = await readSpending(projectFile)
    if (!before.ok) return before
    const { recordings, music } = add(before)
    const saved = needsVersion2(recordings, music)
      ? { version: 2, recordings, music }
      : { version: 1, recordings }
    await writeAtomic(dirname(projectFile), SPENDING_FILE, `${JSON.stringify(saved, null, 1)}\n`)
    return { ok: true, recordings, music }
  })
}

/** Adds a finished recording to the record. */
export function appendRecording(projectFile: string, recording: Recording): Promise<SpendingRead> {
  return appendTo(projectFile, (read) => ({ ...read, recordings: [...read.recordings, recording] }))
}

/** Adds a paid music take to the record (version 2). */
export function appendMusic(projectFile: string, take: MusicSpend): Promise<SpendingRead> {
  return appendTo(projectFile, (read) => ({ ...read, music: [...read.music, take] }))
}

/** A paid recording being followed: tell it how it ended. */
export interface Followed {
  /** Saves the recording, if it cost anything, and stops showing it as running. */
  end(result: { lines: number; outcome: Outcome }): Promise<void>
}

/** What a recording reports while it runs. */
export interface Progress {
  /** Lines recorded so far. */
  lines: number
}

/**
 * The paid recordings of one studio: the running ones, in memory and read live, and the finished
 * ones, saved to the record as each ends. Free recordings (a budget given no dollars) are not
 * followed, and a recording that cost nothing is not saved.
 */
export interface SpendLog {
  /**
   * Starts following a recording of `planned` lines charged to `budget` (Fish's dollars) and
   * `credits` (ElevenLabs', when it has lines with ElevenLabs voices); `progress` is read whenever
   * the page asks.
   */
  follow(options: {
    part: string
    language: string
    model: string
    stage: 'draft' | 'final'
    planned: number
    budget: Budget
    credits?: Budget
    progress: () => Progress
  }): Followed
  /** The recordings going on now. */
  running(): Running[]
}

/** A spend log saving into the project's record. */
export function createSpendLog(projectFile: string): SpendLog {
  const live = new Map<string, () => Running>()
  return {
    follow({ part, language, model, stage, planned, budget, credits, progress }) {
      const elevenlabs = credits && credits.dollars > 0 ? credits : null
      if (budget.dollars <= 0 && !elevenlabs) return { end: async () => {} }
      const id = randomUUID()
      const at = new Date().toISOString()
      // The ElevenLabs credits spent, and their model, on a recording given any.
      const eleven = () =>
        elevenlabs ? { credits: elevenlabs.spent, elevenModel: elevenlabs.model } : {}
      live.set(id, () => ({
        id,
        at,
        part,
        language,
        model,
        planned,
        lines: progress().lines,
        cost: budget.spent,
        ...eleven(),
      }))
      return {
        async end({ lines, outcome }) {
          try {
            // Saving the spend must never undo or crash the recording it describes.
            if (budget.spent > 0 || (elevenlabs?.spent ?? 0) > 0) {
              const saved = await appendRecording(projectFile, {
                id,
                at,
                part,
                language,
                model,
                stage,
                lines,
                planned,
                cost: budget.spent,
                ...eleven(),
                outcome,
              })
              if (!saved.ok) {
                console.error(
                  'Audio Studio: a paid recording was not saved: the spending record is damaged.',
                )
              }
            }
          } catch (error) {
            console.error(
              'Audio Studio: could not save a paid recording to the spending record:',
              error,
            )
          } finally {
            live.delete(id)
          }
        },
      }
    },
    running: () => [...live.values()].map((read) => read()),
  }
}
