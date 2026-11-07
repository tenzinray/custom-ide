#!/bin/bash
set -euo pipefail
umask 077

file_only=false
if [[ ${1:-} == --file ]]; then
	file_only=true
	shift
fi
if (( $# > 0 )); then
	text=$1
else
	text=$(cat)
fi
if [[ -z ${text//[[:space:]]/} ]]; then
	echo 'Usage: siri-tts.sh [--file] "text to speak"' >&2
	exit 2
fi

cache="${XDG_CACHE_HOME:-$HOME/.cache}/pi-chat/tts/msgs"
mkdir -p "$cache"
find "$cache" -type f -name '*.m4a' -mmin +1440 -delete
hash=$(printf '%s' "$text" | shasum -a 256 | cut -d ' ' -f 1)
audio="$cache/$hash.m4a"
if [[ ! -s $audio ]]; then
	temporary=$(mktemp -d "$cache/.generating.XXXXXXXX")
	trap 'rm -rf "$temporary"' EXIT
	printf '%s\n' "$text" | shortcuts run 'Siri TTS' -i - -o "$temporary/audio.m4a"
	if [[ ! -s $temporary/audio.m4a ]]; then
		echo 'Siri TTS did not produce audio.' >&2
		exit 1
	fi
	mv -f "$temporary/audio.m4a" "$audio"
fi

if $file_only; then
	printf '%s\n' "$audio"
else
	afplay "$audio"
fi
