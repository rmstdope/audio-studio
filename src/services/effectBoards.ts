import { readdir } from 'node:fs/promises'
import { EffectBoardSchema, type EffectBoard } from '../core/effectTakes'
import { resolveInRoot } from '../core/paths'
import type { Problem } from '../core/project'
import { readResource } from './files'
import type { ProjectFailure } from './workspace'
import { CACHE_DIR } from '../core/project'

/** Where an effect's takes are cached, one folder per effect. */
export const EFFECT_TAKES_DIR = `${CACHE_DIR}/effect-takes`

/** Where an effect's board is saved: one file per effect (an effect id is a slug, so a safe file name). */
export const EFFECT_BOARD_DIR = `${CACHE_DIR}/effect-boards`

/** An effect's board file, relative to the project root. */
export const boardFile = (id: string) => `${EFFECT_BOARD_DIR}/${id}.json`

/** An effect's board; an empty one before its first take; the problems if its file is broken. */
export async function readEffectBoard(
  root: string,
  id: string,
): Promise<EffectBoard | ProjectFailure> {
  const problems: Problem[] = []
  const path = boardFile(id)
  const board = await readResource(root, path, EffectBoardSchema, problems)
  if (board === 'missing') return { next: 1, takes: [] }
  if (board === 'invalid') return { ok: false, file: path, problems }
  return board
}

/** The ids of the effects with at least one take on their board (a board that cannot be read counts as none). */
export async function effectsWithTakes(root: string): Promise<Set<string>> {
  let names: string[]
  try {
    names = await readdir(resolveInRoot(root, EFFECT_BOARD_DIR))
  } catch {
    return new Set()
  }
  const ids = names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -'.json'.length))
  const made = await Promise.all(
    ids.map(async (id) => {
      const board = await readEffectBoard(root, id)
      return 'takes' in board && board.takes.length > 0 ? id : null
    }),
  )
  return new Set(made.filter((id): id is string => id !== null))
}
