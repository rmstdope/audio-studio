import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  DESIGN_COUNT,
  DESIGN_PRICE,
  descriptionState,
  designCredit,
  designPoints,
} from '../../../core/design'
import { ELEVEN_DESIGN_COUNT, elevenDesignPoints } from '../../../core/elevenDesign'
import { usd } from '../../../core/spend'
import type { VoiceProvider } from '../../../core/voices'
import { useCredit, useDesigns, useDesignVoices, useElevenAccount } from '../../api'
import { designFailureLine } from '../../board'
import { Confirm } from '../../components/Confirm'
import { planLeftLine } from '../../sitting'

/**
 * The box that designs voices from a description, on the character page and on the audition
 * board: whose design (Fish's, in dollars, or ElevenLabs', in credits of the plan), the text (it
 * opens with the last one sent, else a start made from the casting brief), the confirm of the
 * cost, the wait and the failure. A design that works calls `onDone`. Escape closes the box, or
 * goes back from the confirm to the box.
 */
export function DesignVoice({
  characterId,
  language,
  name,
  start,
  auditioning,
  onDone,
  onClose,
}: {
  characterId: string
  /** The language of the audition, in a project with several: the designs are kept per language. */
  language?: string
  name: string
  /** The starting text when nothing was sent before. */
  start: string
  /** Whether an audition is going on for the character: if not, paying starts one. */
  auditioning: boolean
  onDone: () => void
  onClose: () => void
}) {
  const designs = useDesigns(characterId, language)
  const credit = useCredit()
  const design = useDesignVoices(characterId, language)
  const [typed, setTyped] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [provider, setProvider] = useState<VoiceProvider>('fish')
  const eleven = provider === 'elevenlabs'
  // ElevenLabs' plan is read when its confirm opens, for what is left on it.
  const account = useElevenAccount(eleven && confirming)
  const plan = designs.data?.ok ? designs.data.eleven : null
  const field = useRef<HTMLTextAreaElement>(null)
  const pay = useRef<HTMLButtonElement>(null)
  const retry = useRef<HTMLButtonElement>(null)

  const last = designs.data?.ok ? designs.data.description : null
  const text = typed ?? last ?? start
  const state = descriptionState(text)
  const pending = design.isPending
  const failure = design.data && !design.data.ok ? design.data : undefined
  const money = designCredit(
    credit.isFetching ? undefined : credit.data?.ok ? credit.data.credit : null,
  )

  // Focus lands in the text when the box opens, and comes back to it from the confirm.
  useEffect(() => {
    if (!confirming) field.current?.focus()
  }, [confirming])
  // The credit may have changed since it was last read: ask when the confirm opens.
  const { refetch } = credit
  useEffect(() => {
    if (confirming && !eleven) void refetch()
  }, [confirming, eleven, refetch])
  useEffect(() => {
    if (!confirming) return
    if (eleven) pay.current?.focus()
    else if (money.kind === 'ask') pay.current?.focus()
    else if (money.kind === 'cannot') retry.current?.focus()
  }, [confirming, eleven, money.kind])

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || pending) return
    event.stopPropagation()
    if (confirming) setConfirming(false)
    else onClose()
  }

  function send() {
    setConfirming(false)
    design.mutate(
      eleven && plan
        ? { description: text.trim(), provider: 'elevenlabs', credits: plan.credits }
        : { description: text.trim(), provider: 'fish' },
      { onSuccess: (result) => result.ok && onDone() },
    )
  }

  return (
    <div className="design" onKeyDown={onKeyDown}>
      <section className="panel design-box" aria-label="Design a voice">
        <h2 className="section-title">Design a voice</h2>
        <div className="stage-switch" role="radiogroup" aria-label="Design with">
          {(['fish', 'elevenlabs'] as const).map((who) => (
            <label key={who} className={provider === who ? 'on' : ''}>
              <input
                type="radio"
                name={`design-with-${characterId}`}
                checked={provider === who}
                disabled={pending}
                onChange={() => {
                  setProvider(who)
                  design.reset()
                }}
              />
              {who === 'fish' ? 'Fish Audio' : 'ElevenLabs'}
            </label>
          ))}
        </div>
        <p className="muted">
          {eleven
            ? `Describe the voice you want. ElevenLabs makes ${ELEVEN_DESIGN_COUNT} voices from it, each saying the audition phrase and ${name}’s lines; they join the audition board.`
            : `Describe the voice you want. Fish makes ${DESIGN_COUNT} voices from it, each saying the audition phrase; they join the audition board.`}
        </p>
        <textarea
          ref={field}
          className="search design-text"
          aria-label="Description of the voice"
          rows={4}
          value={text}
          disabled={pending}
          aria-invalid={state.tooLong !== null}
          onChange={(event) => {
            setTyped(event.target.value)
            design.reset()
          }}
        />
        {state.count && !state.tooLong && <span className="muted design-count">{state.count}</span>}
        {state.tooLong && (
          <span className="adopt-error" role="alert">
            {state.tooLong}
          </span>
        )}
        {pending && (
          <span className="muted">
            {eleven
              ? `ElevenLabs is making ${ELEVEN_DESIGN_COUNT} voices.`
              : `Fish is making ${DESIGN_COUNT} voices.`}
          </span>
        )}
        {design.isError && <span className="adopt-error">{design.error.message}</span>}
        {failure && (
          <span className="adopt-error" role="alert">
            {designFailureLine(
              failure as { reason?: string; message?: string },
              provider,
              plan?.credits,
            )}
          </span>
        )}
        <div className="design-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={!state.canSend || pending || confirming}
            onClick={() => setConfirming(true)}
          >
            {pending ? 'Designing…' : 'Design voices…'}
          </button>
          <button className="btn btn-ghost" type="button" disabled={pending} onClick={onClose}>
            Cancel
          </button>
        </div>
      </section>
      {confirming && eleven && (
        <Confirm
          title="Design voices with ElevenLabs?"
          effects={
            plan
              ? elevenDesignPoints(name, auditioning, plan.text)
              : ['There is no audition phrase to design with; write one first.']
          }
          note={planLeftLine(account.error ?? account.data?.account, account.data?.held ?? 0)}
          back="Cancel"
          onBack={() => setConfirming(false)}
        >
          <button
            ref={pay}
            className="btn btn-primary"
            type="button"
            disabled={!plan}
            onClick={send}
          >
            {plan?.text === null
              ? `Use up to ${plan.credits.toLocaleString('en-US')} credits`
              : `Use ${(plan?.credits ?? 0).toLocaleString('en-US')} credits`}
          </button>
        </Confirm>
      )}
      {confirming &&
        !eleven &&
        (money.kind === 'cannot' ? (
          <Confirm
            title="Fish can’t design voices now"
            effects={[money.message]}
            back="Cancel"
            onBack={() => setConfirming(false)}
          >
            <button
              ref={retry}
              className="btn"
              type="button"
              disabled={credit.isFetching}
              onClick={() => void refetch()}
            >
              Try again
            </button>
          </Confirm>
        ) : (
          <Confirm
            title="Design voices with Fish?"
            effects={designPoints(name, auditioning)}
            note={
              money.kind === 'ask' ? `Your credit: ${usd(money.credit)}` : 'Reading your credit…'
            }
            back="Cancel"
            onBack={() => setConfirming(false)}
          >
            <button
              ref={pay}
              className="btn btn-primary"
              type="button"
              disabled={money.kind !== 'ask'}
              onClick={send}
            >
              Pay up to {usd(DESIGN_PRICE)}
            </button>
          </Confirm>
        ))}
    </div>
  )
}
