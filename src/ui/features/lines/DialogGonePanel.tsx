import type { Recorded } from '../../../core/summary'
import type { useRefreshDialog } from '../../api'
import { dialogGonePanel } from '../../languages'

/**
 * The amber panel for a dialog file that is gone while recordings were made with it: the studio
 * keeps them, offers to remove none, and says how to get the dialog back. The overview gives the
 * whole account (with the file's path), the lines page the short one. The language is null in a
 * one-language project; the button is there only when the game can refresh.
 */
export function DialogGonePanel({
  variant,
  partTitle,
  partLabel,
  language,
  path,
  recorded,
  canRefresh,
  refresh,
}: {
  variant: 'overview' | 'lines'
  partTitle: string
  partLabel: string
  language: string | null
  path: string
  recorded: Recorded
  canRefresh: boolean
  refresh: ReturnType<typeof useRefreshDialog>
}) {
  const panel = dialogGonePanel({ partTitle, partLabel, language, recorded, canRefresh })
  return (
    <section className="problems dialog-gone" role="status">
      <h2>{panel.heading}</h2>
      {variant === 'overview' ? (
        <>
          <p>
            <span className="mono">{path}</span>
            {panel.before}
          </p>
          <p className="muted">{panel.advice}</p>
        </>
      ) : (
        <p>{panel.lines}</p>
      )}
      {panel.refresh && (
        <div>
          <button className="btn" type="button" disabled={refresh.pending} onClick={refresh.start}>
            {refresh.pending ? 'Refreshing dialog…' : 'Refresh dialog'}
          </button>
        </div>
      )}
    </section>
  )
}
