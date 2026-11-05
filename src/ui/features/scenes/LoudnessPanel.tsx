import { useEffect, useRef, useState } from 'react'
import { sameMix, scaleDraft, toMix, type SceneDraft } from '../../../core/sceneEdit'
import {
  chipFor,
  expectedFigures,
  shiftStates,
  splitClipPaths,
  suggestChange,
  formatLufs,
  targetLine,
  type LoudnessTarget,
  type SceneMeasure,
} from '../../../core/sceneLoudness'
import {
  clipsOf,
  type SceneAct,
  type SceneEffectChoice,
  type SceneMix,
  type SceneRow,
} from '../../../core/scenes'
import type { Moved } from '../../sceneDraft'
import { changeWord, limitLine, measuredLine, suggestionLine } from '../../scenesText'

/** How far a measure of the act has got. */
export interface Running {
  done: number
  total: number
}

/** The figures the panel shows: the saved scene's, or the unsaved scene's when the page still has what it was measured from. */
function shown(
  scene: SceneRow,
  page: SceneMix,
  dirty: boolean,
  pressed: Moved | null,
): { measure: SceneMeasure; unsaved: boolean } | null {
  const draft = scene.loudness.draft
  // The unsaved scene's measure shows while the page is what it was made from (or what a press on
  // it made), or while the scene has no other (then it says it changed).
  if (
    dirty &&
    draft &&
    (sameMix(draft.entry, page) ||
      pressed?.measuredAt === draft.measuredAt ||
      !scene.loudness.saved)
  ) {
    return { measure: draft, unsaved: true }
  }
  return scene.loudness.saved ? { measure: scene.loudness.saved, unsaved: false } : null
}

/**
 * The open scene's loudness: a figure for each of its states against the project's target, from the
 * last measure of the act, and the button that measures every scene of the act again (§8.11).
 */
export function LoudnessPanel({
  scene,
  act,
  actName,
  choices,
  target,
  draft,
  dirty,
  pressed,
  running,
  refused,
  onMeasure,
  onApply,
}: {
  scene: SceneRow
  act: SceneAct
  actName: string
  choices: SceneEffectChoice[]
  target: LoudnessTarget | null
  draft: SceneDraft
  dirty: boolean
  /** The press of "Make … louder / quieter" the page holds unsaved, if any. */
  pressed: Moved | null
  running: Running | null
  /** Why the last press was refused (the studio's words), if it was. */
  refused: string | null
  /** Starts the measure; given the open scene as the page has it when that has unsaved changes. */
  onMeasure: (open: { scene: string; entry: SceneMix } | null) => void
  /** Puts the levels the suggestion moved on the page. */
  onApply: (next: SceneDraft, moved: Moved) => void
}) {
  const page = toMix(draft)
  const found = shown(scene, page, dirty, pressed)
  // What the measure was made from, against what is there now: the page's scene for an unsaved
  // measure, the saved scene otherwise.
  // The page is the scene to compare with when the measure is an unsaved one, or when a press
  // (unsaved, or kept with the saved scene) is on it and the page may have moved on from it.
  const onPage =
    found !== null &&
    (found.unsaved ||
      (dirty && (pressed?.measuredAt === found.measure.measuredAt || !!found.measure.moved)))
  const now = onPage
    ? {
        entry: page,
        clips: clipsOf(
          draft.music.track,
          draft.effects.map((e) => e.id),
          act.tracks,
          choices,
        ),
      }
    : { entry: scene.entry, clips: scene.clips }
  const kept = found?.measure ?? null
  // A press made on this measure, unsaved or kept with the saved scene.
  const moved = kept && pressed?.measuredAt === kept.measuredAt ? pressed : (kept?.moved ?? null)
  const status = kept ? expectedFigures(kept, moved, now) : null
  const expected = status === 'expected'
  const changed = status === 'changed'
  // The figures a person can trust: as measured, or moved by the change that was made.
  const measure = kept && moved && status !== 'measured' ? shiftStates(kept, moved.db) : kept
  const made = moved && status !== 'measured' ? `then made ${changeWord(moved.db)}` : null
  // Edits on the page since the measure make its figures wrong, whether or not they are saved.
  const edited = kept !== null && dirty && !sameMix(kept.entry, page)
  const suggestion =
    kept && status === 'measured' && !edited && target ? suggestChange(kept, target, page) : null
  // The scene changed after a measure that was off the target (or after a press on one).
  const stale =
    (changed || (edited && status === 'measured')) &&
    kept &&
    target &&
    (moved !== null || suggestChange(kept, target, now.entry ?? page) !== null)
  const line =
    suggestion && suggestion.kind !== 'limit'
      ? suggestionLine(suggestion, target?.tolerance ?? 0)
      : null
  const justMade =
    expected && dirty && moved && pressed?.measuredAt === kept?.measuredAt
      ? `Made ${changeWord(moved.db)}. Save to keep it, Discard to undo.`
      : null
  const when = measure
    ? [
        [measuredLine(measure.measuredAt, new Date()), made].filter(Boolean).join(', '),
        ...(running ? ['being measured again'] : []),
        ...measure.without.map((phrase) => `without ${phrase}`),
        ...(target
          ? []
          : [
              'Set a loudness target and tolerance in the project file to be told which scenes are off.',
            ]),
      ].join(' · ')
    : `Not measured yet. Measure loudness measures every scene in ${actName}.`

  // The end of a measure is announced to a screen reader once.
  const [said, setSaid] = useState('')
  const last = useRef<Running | null>(null)
  useEffect(() => {
    if (last.current && !running) {
      const n = last.current.total
      setSaid(`Measured ${n === 1 ? '1 scene' : `${n} scenes`} in ${actName}.`)
    } else if (running) setSaid('')
    last.current = running
  }, [running, actName])

  const press = () => {
    if (running) return
    onMeasure(dirty ? { scene: scene.id, entry: page } : null)
  }
  return (
    <section className="panel scene-panel" aria-label="Loudness">
      <div className="scene-loud-head">
        <h2>
          Loudness <span className="faint scene-loud-target">{targetLine(target)}</span>
          {expected && <span className="scene-loud-warn"> · expected after your change</span>}
          {changed && <span className="scene-loud-warn"> · changed since measured</span>}
          {!expected && found?.unsaved && (
            <span className="scene-loud-warn"> · with your unsaved changes</span>
          )}
        </h2>
        <button
          className="btn"
          type="button"
          aria-disabled={running ? true : undefined}
          onClick={press}
        >
          {running
            ? `Measuring ${Math.min(running.done + 1, running.total)} of ${running.total}…`
            : 'Measure loudness'}
        </button>
      </div>
      {measure && (
        <table className="scene-loud-table">
          <thead>
            <tr>
              <th>State</th>
              <th>Loudness</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {measure.states.map((row) => {
              const chip = measure.error === null ? chipFor(row.lufs, target) : null
              return (
                <tr key={row.state ?? ''}>
                  <td>{row.state ?? 'The scene'}</td>
                  {measure.error !== null ? (
                    <td className="scene-loud-bad">couldn’t measure</td>
                  ) : row.lufs === null ? (
                    <td className="faint">nothing plays</td>
                  ) : (
                    <td className="scene-loud-figure">{formatLufs(row.lufs)}</td>
                  )}
                  <td>
                    {chip && (
                      <span className={chip.kind === 'on' ? 'chip chip-ok' : 'chip chip-warn'}>
                        {chip.text}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {measure?.error != null && (
        <div className="panel scene-problem">
          Couldn’t measure {scene.name}:{' '}
          {splitClipPaths(measure.error.replace(/\.+$/, '')).map((piece, i) =>
            piece.path ? (
              <code key={i} className="scene-clip-path">
                {piece.text}
              </code>
            ) : (
              piece.text
            ),
          )}
          . The other scenes were measured.
        </div>
      )}
      {refused && <div className="panel scene-problem">{refused}</div>}
      {line && (
        <div
          className={
            suggestion?.kind === 'none' ? 'scene-suggest scene-suggest-muted' : 'scene-suggest'
          }
        >
          <span>
            {line.before}
            {line.strong && <strong>{line.strong}</strong>}
            {line.after}
          </span>
          {line.button && suggestion?.kind === 'change' && kept && (
            <button
              className="btn"
              type="button"
              aria-disabled={running ? true : undefined}
              onClick={() => {
                if (running) return
                onApply(scaleDraft(draft, suggestion.db), {
                  db: suggestion.db,
                  measuredAt: kept.measuredAt,
                })
              }}
            >
              {line.button}
            </button>
          )}
        </div>
      )}
      {suggestion?.kind === 'limit' && (
        <div className="scene-suggest scene-suggest-muted">
          <span>
            {limitLine(suggestion).map((part, i) =>
              part.strong ? <strong key={i}>{part.text}</strong> : part.text,
            )}
          </span>
        </div>
      )}
      {justMade && <p className="faint scene-suggest-note">{justMade}</p>}
      {stale && (
        <p className="faint scene-suggest-note">
          The scene changed since it was measured. Measure loudness again for a suggestion.
        </p>
      )}
      <p className="faint scene-loud-when">{when}</p>
      <span className="sr-only" role="status">
        {justMade ?? said}
      </span>
    </section>
  )
}
