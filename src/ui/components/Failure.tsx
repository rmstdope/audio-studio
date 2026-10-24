import type { Problem } from '../../core/project'
import { Problems } from './Problems'

/** Why an action did nothing, if it did: the problems with the files, or the server's message. */
export function Failure({
  title,
  result,
}: {
  title: string
  result: { ok: boolean; problems?: Problem[]; message?: string } | undefined
}) {
  if (!result || result.ok) return null
  if (result.problems) return <Problems title={title} problems={result.problems} />
  return result.message ? <span className="adopt-error">{result.message}</span> : null
}
