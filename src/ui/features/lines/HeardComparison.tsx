import { useHeard } from '../../api'
import { markMissed } from '../../heard'

/**
 * What Whisper heard of a line's take beside its text, the words it missed marked, so a weak or
 * imperfect score can be judged by ear and eye.
 */
export function HeardComparison({
  partId,
  lineKey,
  text,
}: {
  partId: string
  lineKey: string
  text: string
}) {
  const query = useHeard(partId, lineKey)
  if (query.isPending) return <p className="muted heard-compare">Loading what Whisper heard…</p>
  if (query.isError) {
    return (
      <p className="muted heard-compare">
        Could not load what Whisper heard: {query.error.message}
      </p>
    )
  }
  const result = query.data
  if (!result.ok) {
    return <p className="muted heard-compare">The part’s files need fixing first.</p>
  }
  if (!result.heard) {
    return (
      <p className="muted heard-compare">
        What Whisper heard of this take was not kept: it was checked before the studio kept it.
        Retake the line to see it.
      </p>
    )
  }
  return (
    <dl className="heard-compare">
      <dt>Text</dt>
      <dd>
        {markMissed(text, result.heard.missed).map(({ word, missed }, i) => (
          <span key={i}>
            {i > 0 && ' '}
            {missed ? <mark title="Not heard">{word}</mark> : word}
          </span>
        ))}
      </dd>
      <dt>Whisper heard</dt>
      <dd>{result.heard.words.join(' ') || <span className="muted">Nothing</span>}</dd>
    </dl>
  )
}
