import { useHeard } from '../../api'
import { markMissed } from '../../heard'

/**
 * What Whisper heard of a line's take beside the text it was checked against (the line's, unless
 * changed since), the words it missed marked, so an imperfect score can be judged by eye.
 */
export function HeardComparison({
  partId,
  lineKey,
  language,
}: {
  partId: string
  lineKey: string
  /** The language of the take, in a project with several. */
  language?: string
}) {
  const query = useHeard(partId, lineKey, language)
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
        {markMissed(result.heard.text, result.heard.missed).map(({ word, missed }, i) => (
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
