# as-86w: the classify step of the fast gate cannot run in this project

**What happened:** `produce-bead` _Building_ says to classify the changed paths with
`.cerebro/cerebro/scripts/build-workload --classify` before the fast gate. Here it exits 1 with
"no rust_paths in .cerebro/project.conf - cannot classify safely". Audio Studio is a Bun project
with no Rust, and `project.conf` leaves `rust_paths` commented out, so the step can never succeed
here.

**Why:** `build-workload` treats a missing `rust_paths` as unknown rather than as "nothing is Rust".
The skill does not say what an implementer should do when the classifier refuses.

**Cost:** small: one confusing red exit next to a green `bun run check`, and time spent working out
that the refusal was harmless.

**Prevent by:** declaring `rust_paths` in `.cerebro/project.conf` with a pattern that matches nothing
here (or a documented "none" value), or having `produce-bead` _Building_ say that a refusal on a
project with no `rust_paths` means `non-rust`.

**Seen before:** no.
