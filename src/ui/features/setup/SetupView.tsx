import { FISH_TIERS, type FishTier, type SetupCheck } from '../../../core/setup'
import { useModelsView, useSetFishTier, useSetup } from '../../api'
import { ModelsPanel } from './ModelsPanel'
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
  const models = useModelsView()
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
            onClick={() => void Promise.all([setup.refetch(), models.refetch()])}
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
        <>
          <ModelsPanel />
          <ul className="setup-list">
            {setup.data.checks.map((check) => (
              <SetupCheckRow key={check.id} check={check} />
            ))}
          </ul>
        </>
      )}
    </>
  )
}

/** One row of the checklist: its state, what was found, a menu or a command, and numbered steps. */
export function SetupCheckRow({ check }: { check: SetupCheck }) {
  return (
    <li className="panel setup-check">
      <span className={`setup-state ${check.state}`}>
        {check.state === 'ok' ? <CheckIcon /> : check.state === 'problem' ? <AlertIcon /> : null}
        {check.label ?? STATE[check.state]}
      </span>
      <div className="setup-text">
        <strong>{check.title}</strong>
        <span className="muted">
          {check.detail}
          {check.credit !== undefined && ` ${dollars(check.credit)}`}
        </span>
        {check.tier && <TierMenu chosen={check.tier.chosen} />}
        {check.fix && <code className="setup-fix mono">{check.fix}</code>}
        {check.steps && (
          <>
            <ol className="setup-steps small">
              {check.steps.list.map((step, i) => (
                <li key={i}>
                  <span>
                    {step.parts.map((part, j) =>
                      typeof part === 'string' ? (
                        part
                      ) : (
                        <a key={j} href={part.href} target="_blank" rel="noreferrer noopener">
                          {part.link}
                        </a>
                      ),
                    )}
                  </span>
                  {step.commands?.map((command) => (
                    <code key={command} className="setup-fix mono">
                      {command}
                    </code>
                  ))}
                </li>
              ))}
            </ol>
            <span className="faint small">{check.steps.note}</span>
          </>
        )}
      </div>
    </li>
  )
}

/**
 * The menu on the Requests at once row: what the user has paid Fish in total. A choice is saved
 * at once in the project file; the menu always shows what the last check found saved, so the choice shows while it saves (the check after it asks Fish again), and a failed
 * save leaves it where it was, with a line saying so.
 */
export function TierMenu({ chosen }: { chosen: FishTier | null }) {
  const save = useSetFishTier()
  return (
    <>
      <label className="setup-tier muted">
        What you have paid Fish in total
        <select
          value={save.isPending ? (save.variables ?? '') : (chosen ?? '')}
          onChange={(e) => save.mutate((e.target.value || null) as FishTier | null)}
        >
          <option value="">Choose…</option>
          {FISH_TIERS.map((tier) => (
            <option key={tier.value} value={tier.value}>
              {tier.label}
            </option>
          ))}
        </select>
      </label>
      <span className="muted setup-hint">
        Saved in the project file for everyone on the project.
      </span>
      {save.isError && (
        <span className="adopt-error setup-hint" role="alert">
          Could not save the tier: {save.error.message}. Your choice is not saved.
        </span>
      )}
    </>
  )
}
