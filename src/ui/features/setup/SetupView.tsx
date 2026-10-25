import type { SetupCheck } from '../../../core/setup'
import { useSetup } from '../../api'
import { AlertIcon, CheckIcon } from '../../components/icons'
import { dollars } from '../../format'

const STATE: Record<SetupCheck['state'], string> = {
  ok: 'Ready',
  problem: 'Needs attention',
  off: 'Not used',
}

/**
 * What the studio needs on this machine and in the project, each checked with what to do about
 * it: ffmpeg, uv for Whisper, the Fish key, whether Fish answers, the refresh command.
 */
export function SetupView() {
  const setup = useSetup(true)
  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">Project</span>
          <h1>Setup</h1>
          <span className="muted">
            What recording needs on this machine and in the project, checked each time this page
            opens.
          </span>
        </div>
        <div className="header-actions">
          <button
            className="btn"
            type="button"
            disabled={setup.isFetching}
            onClick={() => void setup.refetch()}
          >
            {setup.isFetching ? 'Checking…' : 'Check again'}
          </button>
        </div>
      </header>
      {setup.isPending ? (
        <p className="panel muted">Checking…</p>
      ) : setup.isError ? (
        <p className="panel muted">Could not check: {setup.error.message}</p>
      ) : !setup.data.ok ? (
        <p className="panel muted">The project file cannot be read; fix it first.</p>
      ) : (
        <ul className="setup-list">
          {setup.data.checks.map((check) => (
            <li key={check.id} className="panel setup-check">
              <span className={`setup-state ${check.state}`}>
                {check.state === 'ok' ? (
                  <CheckIcon />
                ) : check.state === 'problem' ? (
                  <AlertIcon />
                ) : null}
                {STATE[check.state]}
              </span>
              <div className="setup-text">
                <strong>{check.title}</strong>
                <span className="muted">
                  {check.detail}
                  {check.credit !== undefined && ` ${dollars(check.credit)}`}
                </span>
                {check.fix && <code className="setup-fix mono">{check.fix}</code>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
