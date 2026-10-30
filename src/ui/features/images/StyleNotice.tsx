import type { ImagesSummary } from '../../../core/images'
import { Problems } from '../../components/Problems'
import { useStyleSeen } from '../../api'
import { joined, styleNoticeText } from '../../imagesText'

/**
 * The one notice at the top of every Images page when the game's style changed: how many chosen
 * images it left out of date, what changed, and Seen, which puts it away on every page.
 */
export function StyleNotice({ notice }: { notice: NonNullable<ImagesSummary['styleNotice']> }) {
  const seen = useStyleSeen()
  return (
    <section className="notice notice-warn" aria-label="The game's style changed">
      <div className="notice-text">
        <span>
          <strong>The game&apos;s style changed.</strong> {styleNoticeText(notice.count)}
        </span>
        <span className="muted">Changed: {joined(notice.changed)}.</span>
      </div>
      <div className="notice-actions">
        <button
          className="btn"
          type="button"
          disabled={seen.isPending}
          onClick={() => seen.mutate()}
        >
          Seen
        </button>
        {seen.isError && <span className="adopt-error">{seen.error.message}</span>}
        {seen.data && !seen.data.ok && 'problems' in seen.data && (
          <Problems title="Could not be put away" problems={seen.data.problems} />
        )}
      </div>
    </section>
  )
}
