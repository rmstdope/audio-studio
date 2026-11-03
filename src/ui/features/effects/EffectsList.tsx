import { useRef, useState } from 'react'
import type { DroppedEffect, EffectsSummary } from '../../../core/effects'
import { effectSeconds } from '../../../core/effects'
import {
  EFFECT_STATUS_LABEL,
  effectMakingStatus,
  type EffectStatus,
} from '../../../core/effectTakes'
import { useEffectsMaking, useForgetEffect, useRefreshEffects } from '../../api'
import { Confirm } from '../../components/Confirm'
import { DoneStat } from '../../components/DoneStat'
import { Failure } from '../../components/Failure'
import { Problems } from '../../components/Problems'
import { PlayIcon, StopIcon } from '../../components/icons'
import { useClipPlayer } from '../../components/useClipPlayer'
import { useFocusWhenClosed } from '../../components/useFocusWhenClosed'
import { effectsNotice, effectsRefreshSummary, effectsSubtitle } from '../../effectsText'
import { routeHref } from '../../route'
import { showingAttentionText } from '../../status'
import { FailedPanel, RefreshPanel } from '../music/MusicView'

/** The chip class of each status: green when chosen, amber when it needs a look. */
const STATUS_CHIP: Record<EffectStatus, string> = {
  'none-yet': 'chip',
  'not-chosen': 'chip',
  chosen: 'chip chip-ok',
  changed: 'chip chip-warn',
  missing: 'chip chip-warn',
  unknown: 'chip chip-warn',
}

/** The list page of Sound effects: the game's effects, with Refresh from the game. */
export function EffectsList({
  effects,
  attention,
}: {
  effects: EffectsSummary
  attention: boolean
}) {
  const run = useRefreshEffects()
  const making = useEffectsMaking().data ?? {}
  const player = useClipPlayer()
  const result = run.outcome?.result
  const notice = effectsNotice(effects)
  const shown = attention
    ? effects.rows.filter((row) => effects.done.needs.includes(row.id))
    : effects.rows
  const page = (show?: 'attention') => routeHref({ view: 'effects', page: null, show })
  let panel: React.ReactNode = null
  if (run.outcome) {
    if (result?.ok) {
      const summary = effectsRefreshSummary(result.effects, result.change)
      panel = (
        <RefreshPanel
          title="Sound effects refreshed"
          headline={summary.headline}
          added={summary.added}
          removed={summary.removed}
          onClose={run.dismiss}
        />
      )
    } else {
      panel = (
        <FailedPanel result={result ?? null} error={run.outcome.error} onClose={run.dismiss} />
      )
    }
  }
  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">Sound effects</span>
          <h1 tabIndex={-1}>Sound effects</h1>
          <span className="muted">{effectsSubtitle(effects)}</span>
        </div>
        {effects.canRefresh && (
          <div className="header-actions">
            <button className="btn" type="button" disabled={run.pending} onClick={run.start}>
              {run.pending ? 'Refreshing from the game…' : 'Refresh from the game'}
            </button>
          </div>
        )}
      </header>
      {panel}
      {effects.problems.length > 0 && (
        <Problems title="Some sound effects could not be read" problems={effects.problems} />
      )}
      {notice && (
        <section className="panel">
          <p className="muted music-notice">{notice}</p>
        </section>
      )}
      {!notice && effects.rows.length > 0 && (
        <>
          <section className="panel status-panel" aria-label="Effects up to date">
            <div className="stats">
              <DoneStat
                label="Effects up to date"
                done={effects.done.done}
                total={effects.done.total}
                href={page('attention')}
              />
            </div>
            {attention && (
              <p className="status-note muted">
                {showingAttentionText(shown.length, 'sound effect')} <a href={page()}>Show all</a>
              </p>
            )}
          </section>
          <div className="table-box">
            <table className="table effects-table">
              <thead>
                <tr>
                  <th aria-label="Play" />
                  <th>Effect</th>
                  <th>Description</th>
                  <th>Length</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const href = routeHref({ view: 'effects', page: 'effect', effect: row.id })
                  const open = () => {
                    window.location.hash = href
                  }
                  return (
                    <tr
                      key={row.id}
                      className="effects-row"
                      tabIndex={0}
                      onClick={open}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && event.target === event.currentTarget) open()
                      }}
                    >
                      <td className="music-play">
                        {row.current.kind === 'take' && row.current.exists && (
                          <button
                            className={
                              player.playing === row.id ? 'icon-btn music-stop' : 'icon-btn'
                            }
                            type="button"
                            aria-label={
                              player.playing === row.id
                                ? `Stop ${row.name}`
                                : `Play ${row.name}: take ${row.current.take}`
                            }
                            onClick={(event) => {
                              // The row opens the effect's page; the button only plays.
                              event.stopPropagation()
                              player.toggle(
                                row.id,
                                `/api/effects/${encodeURIComponent(row.id)}/current`,
                                // A looping effect comes round until stopped, as the game plays it.
                                row.loops ? { loop: true } : {},
                              )
                            }}
                            onKeyDown={(event) => event.stopPropagation()}
                          >
                            {player.playing === row.id ? <StopIcon /> : <PlayIcon />}
                          </button>
                        )}
                      </td>
                      <td>
                        <strong>{row.name}</strong>
                        <div className="mono muted music-id">{row.id}</div>
                      </td>
                      <td className="effects-description">
                        {row.description}
                        {row.changedHere && <span className="chip chip-warn">changed here</span>}
                        {row.gameChanged && (
                          <span className="chip chip-warn">game&apos;s changed</span>
                        )}
                      </td>
                      <td className="effects-length">
                        {effectSeconds(row.seconds)}
                        {row.loops && <span className="loops-tag">loops</span>}
                      </td>
                      <td>
                        {making[row.id] ? (
                          <span className="chip">{effectMakingStatus(making[row.id]!)}</span>
                        ) : (
                          <span className={STATUS_CHIP[row.status]}>
                            {EFFECT_STATUS_LABEL[row.status]}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <DroppedPanel dropped={effects.dropped} />
    </>
  )
}

/** The effects the game dropped whose description the studio still keeps, each with Forget. */
function DroppedPanel({ dropped }: { dropped: DroppedEffect[] }) {
  const [asking, setAsking] = useState<string | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const refocus = useFocusWhenClosed(asking !== null, opener)
  if (!dropped.length) return null
  const effect = dropped.find((d) => d.id === asking)
  return (
    <>
      <section className="panel music-orphans" aria-label="No longer in the game's list">
        <h2 className="section-title">No longer in the game&apos;s list</h2>
        <span className="muted">
          You changed the description of these, and the game no longer asks for them. Your words are
          kept in case the game lists them again.
        </span>
        <table className="table effects-table">
          <tbody>
            {dropped.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.name}</strong>
                  <div className="mono muted music-id">{row.id}</div>
                </td>
                <td className="effects-description">{row.words}</td>
                <td className="music-orphan-action">
                  <button
                    className="btn"
                    type="button"
                    onClick={(event) => {
                      opener.current = event.currentTarget
                      setAsking(row.id)
                    }}
                  >
                    Forget
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {effect && (
        <ForgetConfirm
          key={effect.id}
          id={effect.id}
          onBack={() => {
            refocus()
            setAsking(null)
          }}
          onForgotten={() => {
            setAsking(null)
            document.querySelector<HTMLElement>('h1')?.focus()
          }}
        />
      )}
    </>
  )
}

/** The question before forgetting: Cancel (or Escape) goes back, Forget deletes the words. */
function ForgetConfirm({
  id,
  onBack,
  onForgotten,
}: {
  id: string
  onBack: () => void
  onForgotten: () => void
}) {
  const forget = useForgetEffect(id)
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !forget.isPending) onBack()
      }}
    >
      <Confirm
        title={`Forget your description of ${id}?`}
        effects={[]}
        note="Your words are deleted. The game no longer lists this effect, so there is nothing else to lose."
        back="Cancel"
        backDisabled={forget.isPending}
        onBack={onBack}
      >
        <button
          className="btn btn-primary"
          type="button"
          disabled={forget.isPending}
          onClick={() => forget.mutate(undefined, { onSuccess: (r) => r.ok && onForgotten() })}
        >
          Forget
        </button>
      </Confirm>
      <Failure title="The description could not be forgotten" result={forget.data} />
      {forget.isError && <span className="adopt-error">{forget.error.message}</span>}
    </div>
  )
}
