import { lineTakeUrl, useLineTakeActions, useLineTakes } from '../../api'
import { PauseIcon, PlayIcon } from '../../components/icons'
import { Problems } from '../../components/Problems'
import { percent, seconds } from '../../status'

/**
 * A line's extra takes, under its row: each played, compared by its score and length, and made
 * the line's clip or dropped; Another take records one more with the free model into the cache.
 * A take made before the line changed is marked stale: it can be heard but not used.
 */
export function LineTakes({
  partId,
  lineKey,
  playing,
  toggle,
}: {
  partId: string
  lineKey: string
  playing: string | null
  toggle: (id: string, url: string) => void
}) {
  const list = useLineTakes(partId, lineKey, true)
  const { take, use, drop } = useLineTakeActions(partId, lineKey)
  const failed = [take.data, use.data].find((r) => r && !r.ok)
  const playId = (id: string) => `take/${lineKey}/${id}`
  return (
    <div className="line-takes">
      {list.isPending ? (
        <span className="muted">Loading takes…</span>
      ) : list.isError ? (
        <span className="adopt-error">Could not load the takes: {list.error.message}</span>
      ) : !list.data.ok ? (
        <Problems title="The takes cannot be listed" problems={list.data.problems} />
      ) : list.data.takes.length === 0 ? (
        <span className="muted">
          No extra takes yet. Another take records the line once more, with the free model, to
          compare with the clip; it costs nothing and changes nothing until you use it.
        </span>
      ) : (
        <ol className="take-list">
          {list.data.takes.map((t) => (
            <li key={t.id} className={t.current ? undefined : 'stale'}>
              <button
                type="button"
                className="icon-btn"
                aria-label={playing === playId(t.id) ? 'Stop' : 'Play the take'}
                onClick={() => toggle(playId(t.id), lineTakeUrl(partId, lineKey, t.id))}
              >
                {playing === playId(t.id) ? <PauseIcon /> : <PlayIcon />}
              </button>
              <span className="mono num">{seconds(t.seconds)}</span>
              <span className="mono num" title="Share of the words Whisper heard">
                {percent(t.heard)}
              </span>
              <span className="muted take-when">
                {new Date(t.at).toLocaleString()}
                {t.current ? '' : ' · made before the line changed'}
              </span>
              <span className="row-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={!t.current || use.isPending}
                  title={
                    t.current
                      ? 'Make this take the line’s clip: encoded and written as a recording is'
                      : 'The line’s cue, text, voice or settings changed since; take it again'
                  }
                  onClick={() => use.mutate(t.id)}
                >
                  {use.isPending && use.variables === t.id ? 'Using…' : 'Use this take'}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={drop.isPending}
                  onClick={() => {
                    if (playing === playId(t.id)) toggle(playId(t.id), '')
                    drop.mutate(t.id)
                  }}
                >
                  Drop
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="row-actions">
        <button
          type="button"
          className="btn"
          disabled={take.isPending}
          title="Record the line once more, with the free model, into the cache"
          onClick={() => take.mutate()}
        >
          {take.isPending ? 'Recording…' : 'Another take'}
        </button>
      </div>
      {failed && 'problems' in failed && (
        <Problems title="The take could not be made" problems={failed.problems} />
      )}
      {failed && 'message' in failed && <span className="adopt-error">{failed.message}</span>}
      {(take.isError || use.isError || drop.isError) && (
        <span className="adopt-error">{(take.error ?? use.error ?? drop.error)?.message}</span>
      )}
    </div>
  )
}
