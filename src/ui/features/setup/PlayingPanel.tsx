import { fadeEntries, fadeSaveFailure } from '../../../core/takeFade'
import { useProject, useSetTakeFade } from '../../api'

/**
 * The Playing takes panel on Setup: how long music takes fade in and out when played in the
 * studio, a menu saved in the project file as soon as a length is picked. The menu shows the new
 * length while it saves and goes back to the saved one if the save fails, with a line saying so;
 * it is never disabled, so focus stays on it. Shows nothing until the project file reads.
 */
export function PlayingPanel() {
  const project = useProject()
  const save = useSetTakeFade()
  if (!project.data?.ok) return null
  const { takeFade, projectFile } = project.data.summary
  const shown = save.isPending ? save.variables : takeFade
  return (
    <section className="panel models" aria-labelledby="playing-heading">
      <h2 id="playing-heading" className="section-title">
        Playing takes
      </h2>
      <span className="muted">
        How music takes sound when you play them in the studio. Saved in{' '}
        <span className="mono">{projectFile}</span> for everyone on the project.
      </span>
      <div className="mrow">
        <div className="mname">Fade in and out</div>
        <div className="mtx">
          <span className="muted">
            Every take fades in at its start and out at its end or when you stop it. The game's own
            file always plays as it is.
          </span>
          <div className="mmenu">
            <select
              aria-label="Fade in and out"
              value={shown}
              onChange={(event) => save.mutate(Number(event.target.value))}
            >
              {fadeEntries(takeFade).map((entry) => (
                <option key={entry.seconds} value={entry.seconds}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
          {save.isError && (
            <span className="adopt-error setup-hint" role="alert">
              {fadeSaveFailure(save.error.message, takeFade)}
            </span>
          )}
        </div>
      </div>
    </section>
  )
}
