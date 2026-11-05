import { useEffect, useRef, useState } from 'react'
import { fixHeading, toMix } from '../../../core/sceneEdit'
import { expectedFigures, shiftStates, type SceneMeasure } from '../../../core/sceneLoudness'
import type { SceneAct, ScenesSummary } from '../../../core/scenes'
import { useRefreshDialog, useSceneLoudness } from '../../api'
import { Problems } from '../../components/Problems'
import { shortTitle } from '../../format'
import type { ScenesRoute } from '../../route'
import { currentScene, statesLine } from '../../scenesText'
import { useSceneClip } from '../../sceneClip'
import { useScenePlay } from '../../sceneRun'
import { useLeaveGuard, useSceneEditor, type Leaving } from '../../sceneDraft'
import { LeaveDialog } from './LeaveDialog'
import { LoudnessPanel } from './LoudnessPanel'
import { PlayBar } from './PlayBar'
import { SceneDetail } from './SceneDetail'
import { SceneList } from './SceneList'

/**
 * An act's Scenes page: its scenes on the left, the open one on the right to change and save, and
 * Refresh from the game, which reads the act's scenes, states and triggers again. One scene at a
 * time can have unsaved changes; whatever would leave it asks first.
 */
export function ScenesPage({
  act,
  route,
  summary,
}: {
  act: SceneAct
  route: ScenesRoute
  summary: Pick<ScenesSummary, 'effects' | 'effectsKnown' | 'loudnessTarget'>
}) {
  const name = shortTitle(act.title)
  const run = useRefreshDialog(act.id)
  const loudness = useSceneLoudness(act.id)
  const clip = useSceneClip()
  const scene = currentScene(act, route)
  const editor = useSceneEditor(act.id, scene)
  const play = useScenePlay(scene, act, editor.draft, summary.effects, clip.stop)
  // While the scene plays, a row's ▶ plays its clip once over it, whatever Mute and Solo say.
  const player = {
    ...clip,
    toggle: (id: string, url: string, how: { level: number; loop?: boolean }) =>
      play.phase === 'playing' ? play.once(url, how.level) : clip.toggle(id, url, how),
  }
  const [leaving, setLeaving] = useState<Leaving | null>(null)
  useLeaveGuard(editor.dirty, setLeaving)
  const saveButton = useRef<HTMLButtonElement>(null)
  // A clip sounding stops when another scene opens: its ▶ is not on the new scene's page.
  const { stop } = clip
  const { reset } = play
  useEffect(() => {
    stop()
    reset()
  }, [scene?.id, stop, reset])
  const refresh = (primary: boolean) =>
    act.canRefresh && (
      <button
        className={primary ? 'btn btn-primary' : 'btn'}
        type="button"
        disabled={run.pending}
        onClick={() => {
          const go = () => {
            play.reset()
            run.start()
          }
          if (editor.dirty) setLeaving({ proceed: go })
          else go()
        }}
      >
        {run.pending ? 'Refreshing from the game…' : 'Refresh from the game'}
      </button>
    )
  const result = run.outcome?.result
  const failed =
    run.outcome && !(result?.ok === true) ? (
      <section className="panel refresh-outcome scenes-failed" aria-label="Refresh from the game">
        <div className="refresh-head">
          <div>
            <strong>Refresh from the game failed.</strong>
            <span>The scenes shown are from the last refresh.</span>
          </div>
          <button className="btn" type="button" onClick={run.dismiss}>
            Close
          </button>
        </div>
        {result && 'problems' in result && (
          <Problems title="What the command wrote cannot be used" problems={result.problems} />
        )}
        <pre className="refresh-output mono">
          {(result && 'output' in result && result.output) ||
            (result && 'message' in result && result.message) ||
            run.outcome.error ||
            ''}
        </pre>
      </section>
    ) : null

  if (act.state !== 'ok' || !scene) {
    return (
      <>
        <header className="page-header">
          <div>
            <span className="crumbs">Scenes</span>
            <h1 tabIndex={-1}>{name}</h1>
          </div>
          {act.state !== 'missing' && <div className="header-actions">{refresh(false)}</div>}
        </header>
        {failed}
        <section className="panel scene-notice">
          {act.state === 'invalid' ? (
            <p className="muted music-notice">
              The scenes for {name} cannot be read; see the problems above.
            </p>
          ) : act.state === 'ok' ? (
            <p className="muted music-notice">The game lists no scenes in {name}.</p>
          ) : (
            <>
              <strong>The game hasn&apos;t listed its scenes yet.</strong>
              <span className="muted">
                Refresh from the game to read its scenes, their states and their triggers.
              </span>
              {refresh(true)}
            </>
          )}
        </section>
      </>
    )
  }
  const { status } = editor
  // An unsaved press moves the figures the list judges the open scene by.
  const pressedOn = [scene.loudness.draft, scene.loudness.saved].find(
    (m) => m && editor.moved && m.measuredAt === editor.moved.measuredAt,
  )
  const expected: SceneMeasure | null =
    pressedOn &&
    editor.moved &&
    editor.reds === 0 &&
    expectedFigures(pressedOn, editor.moved, { entry: toMix(editor.draft), clips: scene.clips }) ===
      'expected'
      ? shiftStates(pressedOn, editor.moved.db)
      : null
  const red = editor.reds > 0
  const word = red
    ? { text: fixHeading(editor.reds), className: 'scene-status scene-status-red' }
    : editor.dirty
      ? { text: 'Unsaved changes', className: 'scene-status' }
      : status.kind === 'saved'
        ? { text: 'Saved', className: 'scene-status scene-status-ok' }
        : null
  const saving = status.kind === 'saving'
  const save = async () => {
    await editor.save()
    saveButton.current?.focus()
  }
  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">Scenes · {name}</span>
          <h1 tabIndex={-1}>{scene.name}</h1>
          <span className="muted">{statesLine(scene)}</span>
        </div>
        <div className="header-actions">
          {word && (
            <span className={word.className} role="status">
              {word.text}
            </span>
          )}
          <button
            className="btn"
            type="button"
            aria-disabled={!editor.dirty || undefined}
            onClick={() => editor.dirty && editor.discard()}
          >
            Discard
          </button>
          <button
            ref={saveButton}
            className="btn btn-primary"
            type="button"
            aria-disabled={!editor.dirty || red || saving || undefined}
            onClick={save}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {refresh(false)}
        </div>
      </header>
      {status.kind === 'failed' && (
        <section className="panel scene-problem" aria-label="Save failed">
          <strong>Couldn&apos;t save {scene.name}.</strong>
          <span>Your changes are still here; try Save again.</span>
          <pre className="refresh-output mono">{status.message}</pre>
        </section>
      )}
      {status.kind === 'conflict' && (
        <ConflictPanel
          name={scene.name}
          onKeep={async () => {
            await editor.keepMine()
            saveButton.current?.focus()
          }}
          onLoad={async () => {
            await editor.loadSaved()
            saveButton.current?.focus()
          }}
        />
      )}
      {failed}
      <div className="scenes-body">
        <SceneList
          act={act}
          open={scene}
          unsaved={editor.dirty ? scene.id : null}
          target={summary.loudnessTarget}
          expected={expected}
        />
        <div className="scene-open">
          {scene.unreadable ? (
            <section className="panel scene-panel">
              <p className="muted">
                This scene&apos;s entry in {act.mixFile} can&apos;t be read; see the problems above.
              </p>
            </section>
          ) : (
            <>
              <LoudnessPanel
                scene={scene}
                act={act}
                actName={name}
                choices={summary.effects}
                target={summary.loudnessTarget}
                draft={editor.draft}
                dirty={editor.dirty}
                pressed={editor.moved}
                running={loudness.running}
                refused={loudness.refused}
                onMeasure={loudness.start}
                onApply={(next, moved) => {
                  editor.apply(next, moved)
                  saveButton.current?.focus()
                }}
              />
              <SceneDetail
                key={scene.id}
                scene={scene}
                act={act}
                summary={summary}
                draft={editor.draft}
                player={player}
                play={play}
                onChange={editor.change}
              />
            </>
          )}
          {!scene.unreadable && (
            <PlayBar
              scene={scene}
              play={play}
              nothing={editor.draft.music.track === null && editor.draft.effects.length === 0}
            />
          )}
        </div>
      </div>
      {leaving && (
        <LeaveDialog
          name={scene.name}
          canSave={!red}
          onCancel={() => setLeaving(null)}
          onDiscard={() => {
            editor.discard()
            leaving.proceed()
            setLeaving(null)
          }}
          onSave={async () => {
            const to = leaving
            setLeaving(null)
            if (await editor.save()) to.proceed()
          }}
        />
      )}
    </>
  )
}

/** The red panel for a scene saved somewhere else since the page read it. */
function ConflictPanel({
  name,
  onKeep,
  onLoad,
}: {
  name: string
  onKeep: () => void
  onLoad: () => void
}) {
  const keep = useRef<HTMLButtonElement>(null)
  useEffect(() => keep.current?.focus(), [])
  return (
    <section className="panel scene-problem" aria-label="Saved somewhere else">
      <strong>{name} was saved somewhere else since you opened it.</strong>
      <span>
        Your changes are still here. Keep yours to save over it, or load the saved one and lose
        yours.
      </span>
      <div className="confirm-actions">
        <button ref={keep} className="btn btn-primary" type="button" onClick={onKeep}>
          Keep mine and save
        </button>
        <button className="btn" type="button" onClick={onLoad}>
          Load the saved one
        </button>
      </div>
    </section>
  )
}
