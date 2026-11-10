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
echo "Preparing Code OSS (log: $LOGS/prelaunch.log)..."
if ! (cd "$ROOT" && node build/lib/preLaunch.ts) > "$LOGS/prelaunch.log" 2>&1; then
	tail -n 60 "$LOGS/prelaunch.log" >&2
	exit 1
fi

if [[ -f "$PID_FILE" ]] && kill -0 "$(<"$PID_FILE")" 2>/dev/null; then
	echo "Reusing watcher (PID $(<"$PID_FILE"), log: $LOGS/watch.log)"
else
	echo "Starting watcher (log: $LOGS/watch.log)..."
	(cd "$ROOT" && exec pnpm run watch) > "$LOGS/watch.log" 2>&1 &
	watch_pid=$!
	echo "$watch_pid" > "$PID_FILE"
	if ! kill -0 "$watch_pid" 2>/dev/null; then
		tail -n 60 "$LOGS/watch.log" >&2
		exit 1
	fi
fi

# The first watch pass cleans and rewrites out/. Launching before it finishes opens a blank window.
echo "Waiting for the initial watch build to finish..."
for ((attempt = 0; attempt < 300; attempt++)); do
	if grep -Fq 'Finished transpilation with 0 errors' "$LOGS/watch.log" \
		&& grep -F 'watch-client-noEmit' "$LOGS/watch.log" | grep -Fq 'with 0 errors' \
		&& grep -F '[watch-extensions' "$LOGS/watch.log" | grep -Fq 'Finished compilation' \
		&& grep -Fq '[watch] build finished' "$LOGS/watch.log"; then
		break
	fi
	if ! kill -0 "$(<"$PID_FILE")" 2>/dev/null; then
		echo "Watcher exited before the build finished. See $LOGS/watch.log" >&2
		tail -n 60 "$LOGS/watch.log" >&2
		exit 1
	fi
	if (( attempt == 299 )); then
		echo "Timed out waiting for the watch build. See $LOGS/watch.log" >&2
		tail -n 60 "$LOGS/watch.log" >&2
		exit 1
	fi
	sleep 1
done

# Normal use keeps the whole profile: settings, sign-ins, extensions, pins, layout and trust.
# Agent/test launches still use the managed launcher's isolated default.
node "$ROOT/scripts/code-oss-launcher/launch.ts" --repo "$ROOT" --skip-prelaunch --persistent-profile -- "$@"
