import type { SpendingRow, SpendingSummary } from '../../../core/spending'
import type { ProjectSummary } from '../../../core/summary'
import { useSpending } from '../../api'
import {
  actText,
  amountText,
  costText,
  languageText,
  linesText,
  modelText,
  totalsLabel,
  whenText,
} from '../../spending'

/**
 * What was spent: a total for everything and for each part (dollars, and ElevenLabs credits when
 * any were used), and every paid recording and music take, newest first. Read only; the running
 * ones update as lines are recorded.
 */
export function SpendingView({ summary }: { summary: ProjectSummary }) {
  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">Project</span>
          <h1>Spending</h1>
          <span className="muted">
            Every recording and music take made with a paid model, newest first. Costs are worked
            out as each line is sent: Fish’s at its prices, ElevenLabs’ in your plan’s credits;
            music at its price a minute. The bills themselves can differ slightly.
          </span>
        </div>
      </header>
      <SpendingBody summary={summary} />
    </>
  )
}

function SpendingBody({ summary }: { summary: ProjectSummary }) {
  const spending = useSpending()
  if (spending.isPending) return <p className="panel muted">Loading spending…</p>
  if (spending.isError) {
    return (
      <p className="panel adopt-error">Couldn’t read what was spent: {spending.error.message}</p>
    )
  }
  const answer = spending.data
  if (!answer.ok) {
    return (
      <div className="spending-error" role="alert">
        <strong>Couldn’t read what was spent: the spending record is damaged.</strong>
        {answer.problems.map((problem, index) => (
          <span key={index} className="muted">
            <code>{problem.file}</code>
            {problem.path && (
              <>
                {' '}
                at <code>{problem.path}</code>
              </>
            )}
            : {problem.message}
          </span>
        ))}
      </div>
    )
  }
  if (answer.count === 0 && answer.takes === 0) {
    return (
      <div className="empty-state">
        <strong>No paid recordings yet.</strong>
        <span>Recordings and music takes made with a free model are not listed here.</span>
      </div>
    )
  }
  return (
    <div className="spending">
      <div className="spending-tiles">
        <div className="spending-tile all">
          <b>{amountText(answer.total, answer.credits)}</b>
          <span>{totalsLabel(answer.count, summary.partLabel, answer.takes)}</span>
        </div>
        {answer.acts.map((act) => (
          <div className="spending-tile" key={act.part}>
            <b>{amountText(act.total, act.credits)}</b>
            <span>
              {act.title}
              {act.removed && <span className="muted"> (no longer in the project)</span>}
            </span>
          </div>
        ))}
      </div>
      <h2 className="spending-heading">Recordings</h2>
      <div className="table-box">
        <table className="table spending-table">
          <thead>
            <tr>
              <th>When</th>
              <th>{summary.partLabel}</th>
              {answer.languages > 1 && <th>Language</th>}
              <th>Model</th>
              <th className="right">Lines</th>
              <th className="right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {answer.rows.map((row) => (
              <Row key={row.id} row={row} acts={answer.acts} languages={answer.languages} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Row({
  row,
  acts,
  languages,
}: {
  row: SpendingRow
  acts: SpendingSummary['acts']
  languages: number
}) {
  const running = row.state === 'running'
  const lines = linesText(row)
  return (
    <tr>
      <td>{whenText(row.at, running)}</td>
      <td>
        {actText(row, acts)}
        {row.removed && <span className="muted"> (no longer in the project)</span>}
      </td>
      {languages > 1 && <td>{row.kind === 'music' ? '' : languageText(row.language)}</td>}
      <td className="mono">{modelText(row)}</td>
      <td className="right">
        {running && <span className="spending-pill">Recording</span>} {lines.count}
        {lines.note && <span className="muted"> {lines.note}</span>}
      </td>
      <td className="right">{costText(row)}</td>
    </tr>
  )
}
