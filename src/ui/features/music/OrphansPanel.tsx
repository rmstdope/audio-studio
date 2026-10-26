import { useRef, useState } from 'react'
import type { OrphanRow } from '../../../core/music'
import { useRemoveOrphan } from '../../api'
import { Confirm } from '../../components/Confirm'
import { Failure } from '../../components/Failure'
import { PauseIcon, PlayIcon } from '../../components/icons'
import { useClipPlayer } from '../../components/useClipPlayer'
import { useFocusWhenClosed } from '../../components/useFocusWhenClosed'
import { chosenOn } from '../../musicText'

/**
 * The music of tracks the game no longer asks for, on the page of the list they were chosen for:
 * each can be heard and removed. Removing asks first, saying what goes. Nothing when there are
 * none.
 */
export function OrphansPanel({ orphans }: { orphans: OrphanRow[] }) {
  const player = useClipPlayer()
  const [asking, setAsking] = useState<string | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const refocus = useFocusWhenClosed(asking !== null, opener)
  if (!orphans.length) return null
  const closeAsking = () => {
    refocus()
    setAsking(null)
  }
  const orphan = orphans.find((o) => o.id === asking)
  return (
    <>
      <section className="panel music-orphans" aria-label="Music the game no longer asks for">
        <h2 className="section-title">Music the game no longer asks for</h2>
        <span className="muted">
          The game dropped these tracks, but their music files are still there.
        </span>
        <table className="table">
          <tbody>
            {orphans.map((row) => {
              const playing = player.playing === row.id
              return (
                <tr key={row.id}>
                  <td className="music-play">
                    <button
                      className="icon-btn"
                      type="button"
                      disabled={!row.fileExists}
                      title={row.fileExists ? undefined : 'Music file missing'}
                      aria-label={
                        row.fileExists
                          ? `${playing ? 'Stop' : 'Play'} ${row.title}`
                          : `Play ${row.title}: music file missing`
                      }
                      onClick={() =>
                        player.toggle(row.id, `/api/music/clips/${encodeURIComponent(row.file)}`)
                      }
                    >
                      {playing ? <PauseIcon /> : <PlayIcon />}
                    </button>
                  </td>
                  <td>
                    <strong>{row.title}</strong>
                    <div className="mono muted music-id">{row.file}</div>
                  </td>
                  <td className="muted small">{chosenOn(row.chosenAt)}</td>
                  <td className="music-orphan-action">
                    <button
                      className="btn"
                      type="button"
                      onClick={(event) => {
                        opener.current = event.currentTarget
                        setAsking(row.id)
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
      {orphan && <RemoveConfirm key={orphan.id} orphan={orphan} onBack={closeAsking} />}
    </>
  )
}

/** The question before removing an orphan: what goes, Cancel, and Remove. */
function RemoveConfirm({ orphan, onBack }: { orphan: OrphanRow; onBack: () => void }) {
  const remove = useRemoveOrphan(orphan.id)
  return (
    <>
      <Confirm
        title={`Remove the music for ${orphan.title}?`}
        effects={[]}
        note={`The game no longer asks for this track. Its music file (${orphan.file}), its takes and any brief changes made here are deleted.`}
        back="Cancel"
        backDisabled={remove.isPending}
        onBack={onBack}
      >
        <button
          className="btn btn-primary"
          type="button"
          disabled={remove.isPending}
          onClick={() => remove.mutate(undefined, { onSuccess: (r) => r.ok && onBack() })}
        >
          {remove.isPending ? 'Removing…' : 'Remove'}
        </button>
      </Confirm>
      <Failure title="The music could not be removed" result={remove.data} />
    </>
  )
}
