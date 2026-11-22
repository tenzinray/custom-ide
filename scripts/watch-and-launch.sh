#!/usr/bin/env bash
#---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See License.txt in the project root for license information.
#---------------------------------------------------------------------------------------------
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
LOGS="$ROOT/logs"
mkdir -p "$LOGS"
PID_FILE="$LOGS/watch.pid"
ATTEMPT_ID="${PREVIEW_HUB_ATTEMPT_ID:-manual-$(date +%s)-$$}"
if [[ "$ATTEMPT_ID" == *[!a-zA-Z0-9-]* ]]; then echo 'Invalid launch attempt ID' >&2; exit 1; fi
echo "[$(date -u +%FT%TZ)] Attempt $ATTEMPT_ID, launcher PID $$ (parent $PPID), repo $ROOT"
echo "Runtime: node $(command -v node) ($(node --version)); pnpm $(command -v pnpm) ($(pnpm --version)); required Node $(<"$ROOT/.nvmrc")"

# Preview Hub keeps the launcher attached so it can track and stop this exact dev app.
launcher_args=(--repo "$ROOT" --skip-prelaunch --persistent-profile)
if [[ "${1:-}" == "--preview-hub" ]]; then
	launcher_args+=(--wait)
	shift
fi

if [[ "${1:-}" == "--stop" ]]; then
	if [[ -f "$PID_FILE" ]]; then
		# Stop the full watch process tree; pnpm starts child watchers that outlive its PID.
		node - "$(<"$PID_FILE")" <<'NODE'
const { execFileSync } = require('node:child_process');
const root = Number(process.argv[2]);
const processes = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' })
	.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
const descendants = [];
function collect(parent) {
	for (const [pid, ppid] of processes) {
		if (ppid === parent) {
			collect(pid);
			descendants.push(pid);
		}
	}
}
if (processes.some(([pid]) => pid === root)) {
	const command = execFileSync('ps', ['-p', String(root), '-o', 'command='], { encoding: 'utf8' });
	if (!command.includes('pnpm run watch')) {
		console.error(`Watcher PID ${root} belongs to another process; refusing to stop it.`);
		process.exit(1);
	}
	collect(root);
	for (const pid of [...descendants, root]) {
		try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
	}
}
NODE
		rm -f "$PID_FILE"
		echo "Stopped watcher. Close the Code OSS window separately."
	else
		echo "No watcher PID found. Close the Code OSS window separately."
	fi
	exit 0
fi

if [[ ! -d "$ROOT/node_modules" ]]; then
	echo "Dependencies are missing. Run: cd '$ROOT' && pnpm install" >&2
	exit 1
fi

# Finish first-time setup before watching so the initial build cannot race the watcher.
prelaunch_log="$LOGS/preview-hub-$ATTEMPT_ID-prelaunch.log"
ln -sfn "$(basename "$prelaunch_log")" "$LOGS/prelaunch.log"
echo "[$(date -u +%FT%TZ)] Prelaunch started (attempt $ATTEMPT_ID, log: $prelaunch_log)..."
if ! (cd "$ROOT" && node build/lib/preLaunch.ts) 2>&1 | node "$ROOT/scripts/code-oss-launcher/logPreviewHub.ts" "$prelaunch_log" "$ATTEMPT_ID"; then
	echo "[$(date -u +%FT%TZ)] Prelaunch FAILED (attempt $ATTEMPT_ID)" >&2
	tail -n 60 "$prelaunch_log" >&2
	exit 1
fi

echo "[$(date -u +%FT%TZ)] Prelaunch finished (attempt $ATTEMPT_ID)"
if [[ -f "$PID_FILE" ]] && kill -0 "$(<"$PID_FILE")" 2>/dev/null; then
	echo "Reusing watcher (PID $(<"$PID_FILE"), log: $LOGS/watch.log)"
else
	watch_log="$LOGS/preview-hub-$ATTEMPT_ID-watch.log"
	ln -sfn "$(basename "$watch_log")" "$LOGS/watch.log"
	echo "[$(date -u +%FT%TZ)] Starting watcher (attempt $ATTEMPT_ID, log: $watch_log)..."
	: > "$watch_log"
	rm -f "$PID_FILE"
	# The bounded logger owns the stream, but publishes pnpm's actual PID for discovery and Stop.
	# No stdout descriptor is inherited from the outer launcher after it exits.
	(cd "$ROOT" && PREVIEW_HUB_LOG_COMMAND='["pnpm","run","watch"]' exec node "$ROOT/scripts/code-oss-launcher/logPreviewHub.ts" --run "$watch_log" "$ATTEMPT_ID" "$PID_FILE") > /dev/null 2>> "$watch_log" &
	logger_pid=$!
	for ((ready = 0; ready < 100; ready++)); do
		if [[ -s "$PID_FILE" ]]; then break; fi
		if ! kill -0 "$logger_pid" 2>/dev/null; then break; fi
		sleep 0.1
	done
	if [[ ! -s "$PID_FILE" ]]; then
		echo "Watcher log process did not report a child PID. See $watch_log" >&2
		tail -n 60 "$watch_log" >&2
		exit 1
	fi
	watch_pid=$(<"$PID_FILE")
	if ! kill -0 "$watch_pid" 2>/dev/null; then
		tail -n 60 "$LOGS/watch.log" >&2
		exit 1
	fi
fi

# The first watch pass cleans and rewrites out/. Wait for runtime output, not the
# non-emitting client typecheck: diagnostics keep running but must not block a window.
echo "Waiting for the initial runtime build (client typechecking continues in the background)..."
previous_pending=''
wait_started=$SECONDS
for ((attempt = 0; attempt < 300; attempt++)); do
	elapsed=$((SECONDS - wait_started))
	pending=()
	if ! grep -Fq 'Finished transpilation with 0 errors' "$LOGS/watch.log"; then pending+=('client transpilation'); fi
	if ! grep -Eq '\[watch-extensions[^]]*\].*Finished compilation' "$LOGS/watch.log"; then pending+=('extension compilation'); fi
	# Match the stable bundle prefix; the message may also describe bundled assets (e.g. the image decoder).
	if ! grep -Fq '[pi-chat] Runtime bundle' "$LOGS/watch.log"; then pending+=('Pi runtime bundle'); fi
	if (( ${#pending[@]} == 0 )); then
		echo "Initial watch build ready after ${elapsed}s. Launching the dev app..."
		break
	fi
	if [[ "${pending[*]}" != "$previous_pending" ]] || (( attempt % 15 == 0 )); then
		echo "[$(date -u +%FT%TZ)] Build pending (${elapsed}s, watcher PID $(<"$PID_FILE")): ${pending[*]}. See $LOGS/watch.log"
		previous_pending="${pending[*]}"
		if (( attempt > 0 && attempt % 15 == 0 )); then
			echo 'Latest watcher output:'
			tail -n 5 "$LOGS/watch.log"
		fi
	fi
	if ! kill -0 "$(<"$PID_FILE")" 2>/dev/null; then
		echo "Watcher exited before the build finished. See $LOGS/watch.log" >&2
		tail -n 60 "$LOGS/watch.log" >&2
		exit 1
	fi
	if (( attempt == 299 )); then
		echo "Timed out waiting for the watch build: ${pending[*]}. See $LOGS/watch.log" >&2
		tail -n 60 "$LOGS/watch.log" >&2
		exit 1
	fi
	sleep 1
done

# Normal use keeps the whole profile: settings, sign-ins, extensions, pins, layout and trust.
# Agent/test launches still use the managed launcher's isolated default.
node "$ROOT/scripts/code-oss-launcher/launch.ts" "${launcher_args[@]}" -- "$@"
