#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/screenshots"
# Prune on capture, not with another background watcher or scheduled job.
find "$root/screenshots" -type f -mmin +1440 -delete

if [[ "${1:-}" == --prune-only && $# == 1 ]]; then
	exit 0
fi
if [[ $# -lt 2 ]]; then
	printf 'Usage: %s <playwright-session> <relative-filename.png> [screenshot options]\n       %s --prune-only\n' "$0" "$0" >&2
	exit 1
fi
session="$1"
filename="$2"
shift 2
case "$filename" in
	''|/*|..|../*|*/../*|*/..) echo 'Screenshot filename must stay inside screenshots/.' >&2; exit 1 ;;
esac
mkdir -p "$(dirname "$root/screenshots/$filename")"
cd "$root"
exec pnpm exec playwright-cli "-s=$session" screenshot "$@" --filename="$root/screenshots/$filename"
