import { useEffect, useRef } from 'react'
import { lineTakeUrl, useLineTakeActions, useLineTakes } from '../../api'
import { PauseIcon, PlayIcon } from '../../components/icons'
import { Problems } from '../../components/Problems'
import { dollars } from '../../format'
import { percent, seconds } from '../../status'
import { extraTakeWords } from '../../takes'

/**
 * A line's extra takes, under its row: each played, compared by its score and length, and made
 * the line's clip or dropped; Another take records one more with the draft model into the cache,
 * on a paid one only after the user pays the most it can cost. A take made before the line changed is marked stale: it can be heard but not used.
 */
export function LineTakes({
  partId,
  lineKey,
  draftModel,
  playing,
  toggle,
}: {
  partId: string
  lineKey: string
  draftModel: string
  playing: string | null
  toggle: (id: string, url: string) => void
}) {
  const list = useLineTakes(partId, lineKey)
  const {
    take,
    use,
    drop,
    refused: failed,
    toConfirm,
    refusal,
    cancel,
  } = useLineTakeActions(partId, lineKey)
  const words = extraTakeWords(draftModel)
  const pay = useRef<HTMLButtonElement>(null)
  const another = useRef<HTMLButtonElement>(null)
  // The price appearing takes focus, so Enter pays; backing out returns it to Another take.
  useEffect(() => {
    if (toConfirm !== null) pay.current?.focus()
  }, [toConfirm])
  const back = () => {
    cancel()
    // Another take is rendered again by the time the browser can focus it.
    setTimeout(() => another.current?.focus(), 0)
  }
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
        <span className="muted">{words.empty}</span>
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
      <div
        className="row-actions take-actions"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && toConfirm !== null) {
            e.stopPropagation()
            back()
          }
        }}
      >
        {toConfirm !== null ? (
          <>
            <button
              ref={pay}
              type="button"
              className="btn btn-primary"
              title="The most this take can cost on your Fish account"
              onClick={() => take.mutate(toConfirm)}
            >
              Pay up to {dollars(toConfirm)}
            </button>
            <button type="button" className="btn" onClick={back}>
              Cancel
            </button>
          </>
        ) : (
          <button
            ref={another}
            type="button"
            className="btn"
            disabled={take.isPending}
            title={words.hover}
            onClick={() => take.mutate(undefined)}
          >
            {take.isPending ? 'Recording…' : 'Another take'}
          </button>
        )}
      </div>
      {refusal && <span className="adopt-error">{refusal}</span>}
      {failed && 'problems' in failed.answer && (
        <Problems title={failed.what} problems={failed.answer.problems} />
      )}
      {failed && 'message' in failed.answer && (
        <span className="adopt-error">{failed.answer.message}</span>
      )}
      {(take.isError || use.isError || drop.isError) && (
        <span className="adopt-error">{(take.error ?? use.error ?? drop.error)?.message}</span>
      )}
    </div>
  )
}
