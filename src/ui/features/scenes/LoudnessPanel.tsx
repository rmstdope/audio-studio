import { useEffect, useRef, useState } from 'react'
import { sameMix, toMix, type SceneDraft } from '../../../core/sceneEdit'
import {
  chipFor,
  formatLufs,
  measureChanged,
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
import { measuredLine } from '../../scenesText'

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
): { measure: SceneMeasure; unsaved: boolean } | null {
  const draft = scene.loudness.draft
  // The unsaved scene's measure shows while the page is what it was made from, or while the scene
  // has no other (then it says it changed).
  if (dirty && draft && (sameMix(draft.entry, page) || !scene.loudness.saved)) {
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
  running,
  refused,
  onMeasure,
}: {
  scene: SceneRow
  act: SceneAct
  actName: string
  choices: SceneEffectChoice[]
  target: LoudnessTarget | null
  draft: SceneDraft
  dirty: boolean
  running: Running | null
  /** Why the last press was refused (the studio's words), if it was. */
  refused: string | null
  /** Starts the measure; given the open scene as the page has it when that has unsaved changes. */
  onMeasure: (open: { scene: string; entry: SceneMix } | null) => void
}) {
  const page = toMix(draft)
  const found = shown(scene, page, dirty)
  // What the measure was made from, against what is there now: the page's scene for an unsaved
  // measure, the saved scene otherwise.
  const now = found?.unsaved
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
  const changed = found ? measureChanged(found.measure, now) : false
  const measure = found?.measure ?? null
  const when = measure
    ? [
        measuredLine(measure.measuredAt, new Date()),
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
          {changed && <span className="scene-loud-warn"> · changed since measured</span>}
          {found?.unsaved && <span className="scene-loud-warn"> · with your unsaved changes</span>}
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
          Couldn’t measure {scene.name}: {measure.error.replace(/\.+$/, '')}. The other scenes were
          measured.
        </div>
      )}
      {refused && <div className="panel scene-problem">{refused}</div>}
      <p className="faint scene-loud-when">{when}</p>
      <span className="sr-only" role="status">
        {said}
      </span>
    </section>
  )
}
