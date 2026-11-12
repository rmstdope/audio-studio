# as-kw3x.1: three unrelated server tests failed under load, then passed

**What happened.** The first full `bun run check` locally, and the CI run on the first review-fix head, each failed the same three tests ("remaking patches on a new take" ×2, with "the takes never finished", and "server, what music takes cost"), none near the sidebar. A re-run of the same head, and a second local run, were green.

**Why.** Not established; they time out or race when the machine is busy.

**Cost.** One local re-run (~3 min) and one CI re-run (~3 min).

**Prevent by.** Not established; a bead for the flaky server tests would be the navigator's call.

**Seen before.** Nothing like it yet in `docs/retrospectives/`.
