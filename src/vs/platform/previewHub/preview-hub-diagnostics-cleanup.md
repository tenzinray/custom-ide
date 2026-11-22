# TODO: simplify Preview Hub diagnostics after sustained production stability

Do this only after the user confirms a long stable period. There is no automatic removal date. The production launch was verified working on 2026-11-22; one successful run is not enough to remove safeguards.

## Keep these functional fixes

- Client typechecking stays in the background; only runnable output gates launch (`scripts/watch-and-launch.sh`).
- Open Preview stays enabled and queues each click, including while startup is pending. Additional clicks request additional windows.
- Match the permanent profile through the canonical launcher. Do not count or stop another agent's temporary-profile app.
- Preserve exact child ownership, failure reporting, cancellation, and the readiness contract. A PID or listening browser port alone does not prove a rendered window.
- Keep log retention and size bounds. They are inexpensive lifecycle cleanup, not temporary debugging noise.

## Safe candidates to reduce later

1. **Verbose traces:** remove or demote successful state-change messages, process inventories, per-stage timings, runtime-path dumps, repeated build-tail excerpts, and successful forwarding details. Keep attempt IDs, errors, exit codes/signals, and a concise success/failure result.
   - `node/PreviewHubProcessService.ts`: `pideLog`, state diagnostics, start/window-request messages.
   - `node/PreviewHubPideWindowService.ts`: verbose before/after window details.
   - `scripts/watch-and-launch.sh`: runtime dump and periodic pending-build excerpts.
   - `scripts/code-oss-launcher/launch.ts`: successful profile/CDP/workbench trace messages.
2. **Per-attempt diagnostic artifacts:** if detailed historical bundles are no longer useful, reduce the retained count in `node/previewHubLogs.ts`, or stop recording optional prelaunch/watch detail. Do not remove bounded stream capture while leaving an indefinitely running watcher writing directly to a file.
3. **Automatic DOM probes:** `scripts/code-oss-launcher/waitForWorkbench.ts` is startup-only, not a persistent connection. Remove it only if replacing it with an equally reliable rendered-window acknowledgement. Update the launcher, `node/PreviewHubPideLaunchService.ts`, `node/PreviewHubPideWindowService.ts`, and their tests together. Never silently downgrade success to "some dev process exists."

## Current storage policy

`node/previewHubLogs.ts` is the shared policy for the production service and the checkout's pipe logger (`scripts/code-oss-launcher/logPreviewHub.ts`). It retains ten completed attempt groups, plus active groups protected by writer/launcher PID and process birth time. Text streams use 5 MiB segments with one rollover segment. Cleanup runs on launch/exit/stop, not on a timer. Readiness lives in a small `.ready.json` sidecar so text rotation cannot erase startup evidence. Standard workbench logs keep their existing separate policy.

## Before shipping any simplification

- Run the targeted Preview Hub, launcher/readiness, log-retention, and watch-and-launch tests.
- Update `scripts/code-oss-launcher/README.md` if the readiness/logging contract changes.
- Have the user test the installed production build: cold start, another window, Stop during startup, and a failure with useful logs. An independently launched agent dev window does not count as validation.
- Do not alter installed settings, extensions, profiles, or chats.
