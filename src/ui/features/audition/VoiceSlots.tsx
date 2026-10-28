import { useState } from 'react'
import { useFreeableVoices, useFreeVoices } from '../../api'
import { freeEffects, slotsLine } from '../../board'
import { Confirm } from '../../components/Confirm'
import { plural } from '../../format'

/**
 * The plan's ElevenLabs voice slots on the audition board: how many are used, and a button that
 * frees those of the voices the studio added that nothing uses, asking first.
 */
export function VoiceSlots({
  slots,
  unread,
  onRetry,
}: {
  slots: { used: number; limit: number } | null
  /** Why the account could not be read again, while the slots shown may be out of date. */
  unread?: string
  /** Reads the account again. */
  onRetry: () => void
}) {
  const freeable = useFreeableVoices()
  const free = useFreeVoices()
  const [asking, setAsking] = useState(false)
  const voices = freeable.data?.ok ? freeable.data.voices : []
  const label = `Free ${plural(voices.length, 'voice slot')}`
  const answer = free.data
  return (
    <div className="voice-slots">
      {slots && <span className="muted">{slotsLine(slots)}</span>}
      {unread && (
        <span className="adopt-error" role="alert">
          ElevenLabs’ voice slots couldn’t be read again: {unread.replace(/\.$/, '')}. Takes that
          would add a library voice wait until they are.{' '}
          <button className="btn btn-small" type="button" onClick={onRetry}>
            Try again
          </button>
        </span>
      )}
      {voices.length > 0 && !asking && (
        <button className="btn btn-small" type="button" onClick={() => setAsking(true)}>
          {label}
        </button>
      )}
      {asking && (
        <Confirm
          title={`${label}?`}
          effects={freeEffects(voices)}
          back="Back"
          backDisabled={free.isPending}
          onBack={() => setAsking(false)}
        >
          <button
            className="btn btn-primary"
            type="button"
            disabled={free.isPending}
            onClick={() =>
              free.mutate(
                voices.map((v) => v.voice),
                { onSettled: () => setAsking(false) },
              )
            }
          >
            {free.isPending ? 'Freeing…' : label}
          </button>
        </Confirm>
      )}
      {freeable.data && !freeable.data.ok && <span className="muted">{freeable.data.message}</span>}
      {answer?.ok && answer.freed.length > 0 && (
        <span className="muted" role="status">
          Freed {plural(answer.freed.length, 'voice slot')}.
        </span>
      )}
      {answer?.ok &&
        answer.failed.map((f) => (
          <span key={f.voice} className="adopt-error" role="alert">
            ElevenLabs kept {f.name}: {f.message.replace(/\.$/, '')}.
          </span>
        ))}
      {answer && !answer.ok && freeable.data?.ok && (
        <span className="adopt-error" role="alert">
          {answer.message}
        </span>
      )}
      {free.isError && (
        <span className="adopt-error" role="alert">
          {free.error.message}
        </span>
      )}
    </div>
  )
}
