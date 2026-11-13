# as-o9n9: two bug beads for one cause were fixed in parallel, and the second fix contradicted the first

**What happened.** Psylocke filed two bugs from one verification of as-viyc: as-o9n9 (the failure line shows EACCES and a temporary path) and as-ng94 (the same failure marks the sound-effects model as failing). Both had the same cause: the take's WAV was written with a plain `writeAtomic` instead of `writeOrRefuse`. Bishop and I were each given one, and we wrote the same one-line fix. #491 merged first, and #492 then conflicted on the reproduction test. Before the conflict, I had also answered a review finding by clearing the model's earlier failure on a refused WAV write. as-ng94's acceptance says the model's health stays unchanged, so the two beads now disagreed about behaviour, and I reverted it after the rebase.

**Why.** The two beads were filed as separate symptoms, with no link between them. Neither bugfixer could see that the other was editing the same line, and neither bead named the other.

**Cost.** One review round and one fix commit (the health clear and its test) thrown away, a rebase, and a second fast gate. The PR shrank to a doc sentence.

**Prevent by.** In `verify-content-studio` (or `verify-bead`), when one look turns up several bugs, give each bead a line naming the code path where it fails. Bugs that share a write path go into one bead, or are linked with `bd dep`, so `scripts/bugfix-candidates` hands out only one of them at a time. A bugfixer could also run `git log origin/main -S '<the line it changes>'` before opening the PR.

**Seen before.** Not in these retrospectives.
