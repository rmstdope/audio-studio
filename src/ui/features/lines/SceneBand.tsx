import { useEffect, useRef, useState } from 'react'
import { triedNote } from '../../takes'
import type { SceneState } from '../../../core/planner'
import { takeUrl, useSetSceneCue, useTryCue } from '../../api'
import { Problems } from '../../components/Problems'
import { bandCount, followersHint, warningText, type SceneBandRow } from '../../sceneBands'

/**
 * The band above a run of one scene's lines: its name, its line count and its cue, which opens an
 * editor in the band. `scene` is null for the lines in no scene, which have no cue. `names` is set
 * in a language besides the source, where the scene follows the source's cue until it has its own.
 */
export function SceneBand({
  partId,
  language,
  band,
  scene,
  filtered,
  speakers,
  names,
  columns,
  playing,
  toggle,
}: {
  partId: string
  language?: string
  band: SceneBandRow
  scene: SceneState | null
  /** Whether a filter or search is hiding lines. */
  filtered: boolean
  /** The speakers whose lines follow scene cues (the project's). */
  speakers: string[]
  names: { language: string; source: string } | null
  columns: number
  playing: string | null
  toggle: (id: string, url: string) => void
}) {
  const save = useSetSceneCue(partId, language)
  const hear = useTryCue(partId, language)
  const [draft, setDraft] = useState<string | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  // By the run, so a scene's later band never stops a try playing from its first.
  const tryId = `try/scene/${band.id}`
  const heard = hear.data?.ok ? hear.data : null
  const refused = hear.data && !hear.data.ok ? hear.data : null
  const problems = save.data && !save.data.ok && 'problems' in save.data ? save.data.problems : []
  const own = scene?.cueFrom === 'own' ? scene.cue! : ''

  // Back on the cue button after editing, so the keyboard keeps its place in the table.
  useEffect(() => {
    if (draft === null && refocus.current) {
      refocus.current = false
      button.current?.focus()
    }
  }, [draft])

  // A try still playing stops when the band leaves the table (a filter or search changed).
  const playingNow = useRef(playing)
  playingNow.current = playing
  useEffect(
    () => () => {
      if (playingNow.current === tryId) toggle(tryId, '')
    },
    [tryId, toggle],
  )

  const close = () => {
    refocus.current = true
    if (playing === tryId) toggle(tryId, '')
    hear.reset()
    setDraft(null)
  }
  const done = (result: { ok: boolean }) => result.ok && close()
  const tryIt = () => {
    if (playing === tryId) return toggle(tryId, '')
    hear.mutate(
      { key: scene!.firstFollowing!, cue: draft ?? '' },
      { onSuccess: (result) => result.ok && toggle(tryId, takeUrl(result.key)) },
    )
  }

  const count = bandCount(band, filtered)
  if (scene === null || band.scene === null) {
    return (
      <tr className="scene-band">
        <td colSpan={columns}>
          <div className="scene-band-head">
            <span className="scene-name">{band.title}</span>
            <span className="muted">
              {count} · the game names no scene for these, so they keep their own cue or the
              character’s style
            </span>
          </div>
        </td>
      </tr>
    )
  }

  const label = names ? `Scene cue (${names.language})` : 'Scene cue'
  if (draft === null) {
    return (
      <tr className="scene-band">
        <td colSpan={columns}>
          <div className="scene-band-head">
            <span className="scene-name">{band.title}</span>
            <span className="muted">{count}</span>
            <span className="scene-cue">
              <span className="muted">{label}</span>
              <button
                ref={button}
                type="button"
                className={
                  scene.cue === null
                    ? 'scene-add'
                    : `cue-button mono${scene.cueFrom === 'own' ? '' : ' from-style'}`
                }
                title={
                  scene.cue === null
                    ? 'Give this scene a cue its lines follow'
                    : scene.cueFrom === 'own'
                      ? 'The scene’s cue: edit'
                      : `Follows the ${names?.source} cue: give this scene its own cue`
                }
                onClick={() => {
                  save.reset()
                  setDraft(own)
                }}
              >
                {scene.cue ?? '+ Add a cue'}
              </button>
              {scene.cueFrom === 'source' && names && (
                <span className="muted scene-follows">follows {names.source}</span>
              )}
            </span>
          </div>
        </td>
      </tr>
    )
  }

  // Saving marks lines only when the cue they are said with changes: not for an unchanged draft,
  // nor for a draft that only makes the cue the scene already follows its own.
  const changed = draft.trim() !== own
  const marks = changed && draft.trim() !== (scene.cue ?? '')
  const warning = marks ? warningText(scene.recordedFollowing) : null
  return (
    <tr className="scene-band">
      <td colSpan={columns}>
        <form
          className="scene-edit"
          onSubmit={(event) => {
            event.preventDefault()
            save.mutate({ scene: band.scene!, cue: draft }, { onSuccess: done })
          }}
        >
          <div className="scene-band-head">
            <span className="scene-name">{band.title}</span>
            <span className="muted">{count}</span>
            <span className="muted">{followersHint(speakers)}</span>
          </div>
          <input
            className="mono"
            autoFocus
            aria-label={`Cue for the scene ${band.scene}`}
            placeholder="[a cue for this scene]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && close()}
          />
          {warning && <span className="scene-warning">{warning}</span>}
          <div className="cue-actions">
            <button className="btn btn-primary" type="submit" disabled={save.isPending || !changed}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            {scene.cueFrom === 'own' && (
              <button
                className="btn"
                type="button"
                disabled={save.isPending}
                onClick={() => save.mutate({ scene: band.scene!, cue: '' }, { onSuccess: done })}
              >
                {names && scene.sourceCue ? `Follow ${names.source}` : 'Remove cue'}
              </button>
            )}
            <button className="btn" type="button" onClick={close}>
              Cancel
            </button>
            <button
              className="btn"
              type="button"
              title={
                scene.firstFollowing
                  ? 'Hear the first line that follows the cue said with it, without saving anything (free with a Fish voice, a few credits with an ElevenLabs one)'
                  : 'No line in this scene follows the cue'
              }
              disabled={hear.isPending || !scene.firstFollowing}
              onClick={tryIt}
            >
              {hear.isPending ? 'Recording…' : playing === tryId ? 'Stop' : 'Hear it'}
            </button>
          </div>
          {heard && playing === tryId && (
            <span className="muted cue-tried mono">{heard.spoken}</span>
          )}
          {heard && triedNote(heard) && <span className="muted">{triedNote(heard)}</span>}
          {problems.length > 0 && (
            <Problems title="The scene cue could not be saved" problems={problems} />
          )}
          {save.isError && <span className="adopt-error">{save.error.message}</span>}
          {refused && 'problems' in refused && (
            <Problems title="The cue could not be tried" problems={refused.problems} />
          )}
          {refused && 'message' in refused && (
            <span className="adopt-error">{refused.message}</span>
          )}
          {hear.isError && <span className="adopt-error">{hear.error.message}</span>}
        </form>
      </td>
    </tr>
  )
}
