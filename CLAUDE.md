# Repository notes for Claude

## PR monitoring: no timer-based polling

When watching a PR in this repo (via `subscribe_pr_activity` or similar), do
**not** schedule a recurring `send_later`/check-in wakeup "just in case" to
re-check CI or mergeability. The PR subscription already delivers CI
failures, new comments, reviews, and check-suite completions as events —
that is the mechanism for staying informed, not a timer.

- Rely on the webhook/event subscription to wake the session when something
  actually happens (CI result, comment, review, merge-conflict transition).
- Do not create a `send_later` reminder to "check back in an hour" after
  confirming a PR is green/mergeable/draft with nothing pending — that just
  burns tokens re-fetching state that hasn't changed.
- If you must schedule a follow-up (e.g. because the harness note asks for
  one), only do it when there is a concrete, unresolved blocker you are
  actively waiting on — not as a routine heartbeat.
- When the user says they're stepping away and will check back later,
  don't compensate by scheduling checks on their behalf; just leave the
  PR subscribed and let events (or the user, on return) drive the next step.
