import type { ImagesAct, ImageRow, ImagesSummary } from '../../../core/images'
import { useImageMaking, useRefreshDialog } from '../../api'
import { shortTitle } from '../../format'
import { chosenLine, disagreeText } from '../../imagesText'
import { ActLinks } from './ActLinks'
import { makingStatusText } from '../../musicTakesText'
import { routeHref } from '../../route'
import { FailedPanel, RefreshPanel } from '../music/MusicView'

/** The chip class of each status: muted until chosen, green when chosen, amber when out of date. */
const STATUS_CHIP: Record<ImageRow['status'], string> = {
  'none yet': 'chip',
  chosen: 'chip chip-ok',
  'out of date': 'chip chip-warn',
}

/** An act's page: its images with the words they are made from, their size and status. */
export function ActPage({ act, images }: { act: ImagesAct; images: ImagesSummary }) {
  const name = shortTitle(act.title)
  const run = useRefreshDialog(act.id)
  const making = useImageMaking().data ?? {}
  const result = run.outcome?.result
  let panel: React.ReactNode = null
  if (run.outcome) {
    panel = result?.ok ? (
      <RefreshPanel
        title="Refreshed from the game"
        headline="The game's lists were read again"
        added={[]}
        removed={[]}
        onClose={run.dismiss}
      />
    ) : (
      <FailedPanel result={result ?? null} error={run.outcome.error} onClose={run.dismiss} />
    )
  }
  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">Images</span>
          <h1 tabIndex={-1}>{name}</h1>
          {act.state === 'ok' && (
            <span className="muted">{chosenLine(name, act.rows.length, act.chosen)}</span>
          )}
        </div>
        {act.canRefresh && (
          <div className="header-actions">
            <button className="btn" type="button" disabled={run.pending} onClick={run.start}>
              {run.pending ? 'Refreshing from the game…' : 'Refresh from the game'}
            </button>
          </div>
        )}
      </header>
      {act.state === 'ok' && images.style.present && (
        <p className="muted images-style-line">
          Every prompt ends with the game&apos;s style
          {act.addition !== null && (
            <>
              , and for {name}: <em>{act.addition}</em>
            </>
          )}
          . <a href={routeHref({ view: 'images', page: 'style' })}>Style ›</a>
        </p>
      )}
      {panel}
      {act.state === 'missing' ? (
        <section className="panel">
          <p className="muted music-notice">
            The game has not listed the images for {name} yet. Refresh from the game.
          </p>
        </section>
      ) : act.state === 'invalid' ? (
        <section className="panel">
          <p className="muted music-notice">
            The list of images for {name} cannot be read; see the problems above.
          </p>
        </section>
      ) : act.order.length === 0 ? (
        <section className="panel">
          <p className="muted music-notice">The game asks for no images in {name}.</p>
        </section>
      ) : (
        <div className="table-box">
          <table className="table images-table">
            <thead>
              <tr>
                <th>Image</th>
                <th>Prompt</th>
                <th>Size</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {act.order.map((id) => {
                const conflict = act.conflicts.find((c) => c.id === id)
                if (conflict) {
                  return (
                    <tr key={id} className="images-row-off">
                      <td className="images-name">
                        <strong>{conflict.title}</strong>
                        <div className="mono muted music-id">{id}</div>
                      </td>
                      <td className="images-prompt">
                        <div className="adopt-error">
                          {disagreeText(
                            conflict.acts.map((a) => shortTitle(a.title)),
                            conflict.differs,
                          )}
                        </div>
                      </td>
                      <td className="images-size">—</td>
                      <td className="images-status">
                        <span className="chip chip-danger">lists disagree</span>
                      </td>
                    </tr>
                  )
                }
                const row = act.rows.find((r) => r.id === id)
                return (
                  row && (
                    <tr key={id}>
                      <td className="images-name">
                        <a
                          className="music-track-link"
                          href={routeHref({
                            view: 'images',
                            page: 'image',
                            image: row.id,
                            from: act.id,
                          })}
                        >
                          <strong>{row.title}</strong>
                        </a>
                        <div className="mono muted music-id">{row.id}</div>
                        {row.sharedWith.length > 0 && (
                          <div className="muted images-also">
                            also in <ActLinks acts={row.sharedWith} />
                          </div>
                        )}
                      </td>
                      <td className="images-prompt">
                        <div>{row.words}</div>
                        {row.changed && (
                          <div className="chg">
                            {row.gameChanged
                              ? "changed here · the game's words changed too"
                              : 'changed here'}
                          </div>
                        )}
                        {row.actStyle?.on === false && act.addition !== null && (
                          <div className="chg">{name}&apos;s style left out</div>
                        )}
                      </td>
                      <td className="images-size">
                        {row.width} × {row.height}
                      </td>
                      <td className="images-status">
                        {making[row.id] ? (
                          <span className="chip chip-warn">
                            {makingStatusText(making[row.id]!)}
                          </span>
                        ) : (
                          <span className={STATUS_CHIP[row.status]}>{row.status}</span>
                        )}
                        {row.looksOld && <span className="chip chip-warn">Old look</span>}
                      </td>
                    </tr>
                  )
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
