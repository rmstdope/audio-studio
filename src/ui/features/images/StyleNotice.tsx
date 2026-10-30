import type { ImagesSummary } from '../../../core/images'
import { useStyleSeen } from '../../api'
import { styleNoticeText } from '../../imagesText'

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
        <span className="muted">Changed: {notice.changed.join(' and ')}.</span>
      </div>
      <div className="notice-actions">
        <button
          className="btn"
          type="button"
          disabled={seen.isPending}
          onClick={() =>
            seen.mutate(undefined, {
              // The notice goes away with the reload; focus must not be lost with it.
              onSuccess: () => document.querySelector<HTMLElement>('h1')?.focus(),
            })
          }
        >
          Seen
        </button>
      </div>
    </section>
  )
}
