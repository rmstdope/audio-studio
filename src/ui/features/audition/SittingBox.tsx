import { useEffect } from 'react'
import type { SittingView } from '../../../core/sitting'
import { useCredit, type SittingAnswer } from '../../api'
import { SpendConfirm } from '../../components/SpendConfirm'
import { resumePoints, startPoints } from '../../sitting'

/** Why a sitting action did nothing, as a line for the box; undefined when it did. */
export function sittingFailure(answer: SittingAnswer | undefined): string | undefined {
  if (!answer || answer.ok) return undefined
  return answer.message ?? answer.problems?.map((p) => p.message).join(' ')
}

/**
 * The box that asks what a paid audition may spend: "Audition on <model>?" before one starts, or
 * "Carry on on <model>?" when it goes on after a pause. It reads the account's credit when it
 * opens, and again on Try again.
 */
export function SittingBox({
  kind,
  view,
  busy,
  failure,
  onPay,
  onCancel,
}: {
  kind: 'start' | 'resume'
  view: SittingView
  busy: boolean
  failure?: string
  onPay: (amount: number) => void
  onCancel: () => void
}) {
  const credit = useCredit()
  const { refetch } = credit
  // The credit may have changed since it was last read: ask when the box opens.
  useEffect(() => void refetch(), [refetch])
  return (
    <SpendConfirm
      title={kind === 'start' ? `Audition on ${view.model}?` : `Carry on on ${view.model}?`}
      points={(amount) =>
        kind === 'start'
          ? startPoints(view.model, view.perTake, amount)
          : resumePoints(view.perTake)
      }
      model={view.model}
      perTake={view.perTake}
      suggested={view.suggested}
      credit={credit.isFetching ? undefined : credit.data}
      onRetry={() => void refetch()}
      busy={busy}
      failure={failure}
      onPay={onPay}
      onCancel={onCancel}
    />
  )
}
