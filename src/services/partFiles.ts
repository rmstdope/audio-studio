import { createSerial } from './serial'

/**
 * Writes to a part's manifest and lock, one at a time across the studio (recording lines,
 * adopting clips), each reading the files afresh inside its turn.
 */
const partFiles = createSerial()

/** Runs `job` in the part's turn for writing its manifest and lock. */
export function inPartTurn<T>(
  projectFile: string,
  partId: string,
  job: () => Promise<T>,
): Promise<T> {
  return partFiles.run(`${projectFile}\n${partId}`, job)
}
