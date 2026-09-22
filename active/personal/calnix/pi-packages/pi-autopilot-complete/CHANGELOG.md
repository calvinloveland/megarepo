# Changelog

## 0.5.1 (2026-09-21)

### Fixed
- **Iteration count now resets at the safety limit**: Hitting the
  `MAX_SUPER_AUTOPILOT_ITERATIONS` (50) cap left `superAutopilotIterations`
  pinned at `50/50`. Any later `complete({ futureWork: [...] })` call immediately
  re-tripped the cap, so the loop could never make progress after the first stop.
  The counter (and the item/`lastFutureWork`/nudge state) is now reset when the
  limit branch fires in `agent_end`, and the status bar returns to `0/50`.
- **Esc (abort) no longer counts as a nudge**: Aborting a run made `agent_end`
  fire with `completedWithFutureWork === false`, which triggered the autopilot
  nudge and its `triggerTurn` continuation. In super autopilot mode the nudge cap
  is 50, so a single Esc just queued another turn and the user had to interrupt
  the loop once per allowed nudge (up to 50 times). `agent_end` now detects
  aborted runs (`ctx.signal.aborted`, falling back to `stopReason === "aborted"`
  on the final assistant message) and skips both the nudge and the
  super-autopilot bookkeeping, resetting `autopilotNudges` so the next user
  message gets a fresh budget.

### Changed
- Extension version bumped to `0.5.1`
- Added regression tests for the safety-limit reset and Esc-abort suppression

## 0.5.0 (2026-06-12)

### Added
- **Turn and item counts in final "task is done!" message**: The `complete` tool now
  reports the number of super-autopilot iterations and the count of future work items
  completed in its completion message (e.g. "Task complete after 4 super-autopilot
  iteration(s), completing 12 future work item(s).")
- **Notification in agent_end**: The UI notification when super autopilot finishes
  now includes the same iteration and item counts for quick visibility
- `superAutopilotItemsCompleted` tracking: Tracks the net decrease in futureWork
  size between consecutive complete calls for accurate per-cycle accounting

### Changed
- Extension version bumped to `0.5.0`

## 0.4.0 (2026-06-12)

### Fixed
- **Root cause of super autopilot loop stalling**: The `complete` tool was using `pi.sendMessage(..., { deliverAs: "followUp" })` to queue the next cycle, but this only works when the agent is still streaming. By the time the `complete` tool runs, `isStreaming` is `false`, so the message was pushed directly into agent state instead of queuing as a follow-up. The loop appeared to "block on user input" because the follow-up queue was never populated.

- **Replaced with same-turn approach**: The `complete` tool now returns a non-terminating tool result containing the `=== NEXT TASK ===` block directly in its output. The model sees the tool result and naturally continues working in the same agent turn. No follow-up queue, no `agent_end` re-entry, no timing races.

- **Removed conflicting prompt wording**: When super autopilot is active, the regular autopilot prompt ("The complete tool is your required final action for this task") was previously concatenated alongside the super autopilot prompt ("Do NOT stop after calling complete"). These contradictory instructions caused the model to treat `complete` as the end of the session. Now the regular autopilot prompt is skipped entirely when super autopilot is on.

- **Per-turn state reset moved from `before_agent_start` to `turn_start`**: Auto-follow-up turns queued from the `complete` tool do NOT pass through `before_agent_start`, so `completedWithFutureWork` was never reset between cycles, causing the nudge to be suppressed after the first cycle.

### Changed
- Extension version bumped to `0.4.0`
- Inline logging replaced with shared `createLogger` from `../../shared-utils/logger.mjs`
- Log path moved to `/tmp/pi-ext/autopilot-complete.log`
- `agent_end` logging now includes `isIdle` and `hasPendingMessages` state for debugging
- Board sizing log messages in `game_state.py` clarified with `(rows)`/`(cols)` labels

### Added
- 10 Python unit tests for `GameState.get_stats()`
- 2 multi-cycle integration tests (same-turn continuation, status bar tracking)
- Live smoke test script at `tests/super-autopilot-smoke.sh`
  - Supports `--model <provider/model>` and `SMOKE_MODEL` env var
  - Supports `--min-cycles N` for minimum cycle threshold
  - Validates the multi-turn loop with a real LLM provider
- `docs/issues/board-size-swap.md` documenting the row/column naming convention

## 0.3.0 (2026-06-12)

### Changed
- Switched `complete` tool from `status` field to `futureWork: string[]` API
- Non-empty futureWork no longer terminates (agent continues in same turn)
- Empty futureWork terminates (project done)
- Removed broken `sendUserMessage()` calls (crashed Pi 0.76.0)
- Regular autopilot nudge limit elevated to 50 when super autopilot active
- File-based logging to `/tmp/super-autopilot.log`

### Fixed
- Removed `sendUserMessage` / `agent_end` race condition that caused duplicate continuation messages

## 0.2.0 (2026-06-11)

### Added
- Added `/superautopilot` command with `[on|off|toggle|status]` subcommands
- Added 50-iteration safety limit for super autopilot loop
- Autopilot extension version shown in status commands

## 0.1.0 (2026-06-10)

### Added
- Initial extension with `complete` tool and `/autopilot` command
- Regular autopilot nudge when agent stops without calling complete
- `/max-nudges` command
- TDD mode suppression
- Session state persistence
