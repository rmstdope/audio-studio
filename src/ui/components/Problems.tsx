import type { Problem } from '../../core/project'

/** A list of problems in the project's files, each with its file and place in the JSON. */
export function Problems({
  title,
  problems,
  fatal = false,
}: {
  title: string
  problems: Problem[]
  fatal?: boolean
}) {
  return (
    <section className={`problems${fatal ? ' fatal' : ''}`} role={fatal ? 'alert' : 'status'}>
      <h2>{title}</h2>
      <ul>
        {problems.map((problem, index) => (
          <li key={index}>
            <code>{problem.file}</code>
            {problem.path && (
              <>
                {' '}
                at <code>{problem.path}</code>
              </>
            )}
            : {problem.message}
          </li>
        ))}
      </ul>
    </section>
  )
}
