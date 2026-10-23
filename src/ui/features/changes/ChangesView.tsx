import type { Change, ChangeKind, FileRole, PartChanges } from '../../../core/changes'
import type { ProjectSummary } from '../../../core/summary'
import { useChanges } from '../../api'
import { plural } from '../../format'

const KIND: Record<ChangeKind, { label: string; color: string }> = {
  new: { label: 'New', color: 'var(--ok)' },
  modified: { label: 'Changed', color: 'var(--warn)' },
  deleted: { label: 'Deleted', color: 'var(--danger-ink)' },
  renamed: { label: 'Renamed', color: 'var(--info)' },
  conflict: { label: 'Conflict', color: 'var(--accent)' },
}

const ROLE: Record<FileRole, string> = {
  dialog: 'Dialog',
  cues: 'Cues',
  lock: 'Lock',
  manifest: 'Manifest',
}

/**
 * What git sees of the studio's files since the last commit: the project file and the cast, then
 * each part's files and its clips counted. The studio never commits; the user reviews and commits.
 */
export function ChangesView({ summary }: { summary: ProjectSummary }) {
  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">Project</span>
          <h1>Changes</h1>
          <span className="muted">
            What git sees of the studio’s files since the last commit, in{' '}
            <span className="mono">{summary.root}</span>. The studio never commits: review them and
            commit when you are happy.
          </span>
        </div>
      </header>
      <ChangesBody summary={summary} />
    </>
  )
}

function ChangesBody({ summary }: { summary: ProjectSummary }) {
  const changes = useChanges()
  if (changes.isPending) return <p className="panel muted">Asking git…</p>
  if (changes.isError) {
    return <p className="panel muted">Could not ask git: {changes.error.message}</p>
  }
  const answer = changes.data
  if (!answer.ok) {
    return (
      <p className="panel muted">
        {'message' in answer ? answer.message : 'The project file cannot be read.'}
      </p>
    )
  }
  const { groups } = answer
  if (groups.total === 0) {
    return (
      <div className="empty-state">
        <strong>Nothing to commit</strong>
        <span>Every file the studio writes is as it was in the last commit.</span>
      </div>
    )
  }
  const conflicts =
    groups.project.filter((c) => c.change === 'conflict').length +
    groups.parts.reduce(
      (sum, part) =>
        sum + part.clips.conflict + part.files.filter((f) => f.change === 'conflict').length,
      0,
    )
  return (
    <div className="changes">
      {conflicts > 0 && (
        <span className="adopt-error">
          {plural(conflicts, 'file')} with a merge conflict: resolve{' '}
          {conflicts === 1 ? 'it' : 'them'} in git before committing.
        </span>
      )}
      {groups.project.length > 0 && (
        <section className="panel" aria-label="Project files">
          <span className="label">Project and cast</span>
          <FileList files={groups.project} />
        </section>
      )}
      {groups.parts.map((part) => (
        <PartSection key={part.id} part={part} label={summary.partLabel} />
      ))}
    </div>
  )
}

function PartSection({ part, label }: { part: PartChanges; label: string }) {
  const clips = (Object.entries(part.clips) as [ChangeKind, number][]).filter(([, n]) => n > 0)
  return (
    <section className="panel" aria-label={part.title}>
      <span className="label">
        {label} · {part.title}
      </span>
      {part.files.length > 0 && <FileList files={part.files} />}
      {clips.length > 0 && (
        <div className="change-clips">
          <span>
            {plural(
              clips.reduce((sum, [, n]) => sum + n, 0),
              'clip',
            )}
          </span>
          {clips.map(([kind, n]) => (
            <span key={kind} className="change-kind" style={{ color: KIND[kind].color }}>
              {n} {KIND[kind].label.toLowerCase()}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

function FileList({ files }: { files: (Change & { role?: FileRole })[] }) {
  return (
    <ul className="change-files">
      {files.map((file) => (
        <li key={file.path}>
          <span className="change-kind" style={{ color: KIND[file.change].color }}>
            {KIND[file.change].label}
          </span>
          {file.role && <span className="muted">{ROLE[file.role]}</span>}
          <span className="mono">
            {file.from ? `${file.from} → ` : ''}
            {file.path}
          </span>
        </li>
      ))}
    </ul>
  )
}
