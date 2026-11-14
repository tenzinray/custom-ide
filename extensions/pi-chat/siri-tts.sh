#!/bin/bash
set -euo pipefail
umask 077

file_only=false
control=""
case ${1:-} in
	--file) file_only=true; shift ;;
	--status|--pause|--resume|--stop) control=$1; shift ;;
esac
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
hash=$(printf '%s' "$text" | shasum -a 256 | cut -d ' ' -f 1)
audio="$cache/$hash.m4a"

# Controls target only the afplay child for this exact cached utterance, never another process.
if [[ -n $control ]]; then
	player=$(cat "$audio.pid" 2>/dev/null || true)
	if [[ $player =~ ^[0-9]+$ ]] && [[ $(ps -p "$player" -o command= 2>/dev/null) == "/usr/bin/afplay $audio" ]]; then
		case $control in
			--pause) kill -STOP "$player" ;;
			--resume) kill -CONT "$player" ;;
			--stop) kill -CONT "$player"; kill -TERM "$player" ;;
		esac
		if [[ $control == --stop ]]; then echo idle
		elif [[ $control == --pause ]]; then echo paused
		elif [[ $control == --resume ]]; then echo playing
		elif [[ $(ps -p "$player" -o state= 2>/dev/null) == *T* ]]; then echo paused
		else echo playing; fi
	else
		owner=$(cat "$audio.owner" 2>/dev/null || true)
		if [[ $owner =~ ^[0-9]+$ ]] && [[ $(ps -p "$owner" -o command= 2>/dev/null) == *siri-tts.sh* ]]; then echo generating
		else echo idle; fi
	fi
	exit 0
fi

cleanup_playback() {
	if [[ -n ${player:-} ]] && [[ $(cat "$audio.pid" 2>/dev/null || true) == "$player" ]]; then rm -f "$audio.pid"; fi
	if [[ $(cat "$audio.owner" 2>/dev/null || true) == "$$" ]]; then rm -f "$audio.owner"; fi
}
if ! $file_only; then
	printf '%s\n' "$$" > "$audio.owner"
	trap cleanup_playback EXIT
fi
find "$cache" -type f -name '*.m4a' -mmin +1440 -delete
if [[ ! -s $audio ]]; then
	temporary=$(mktemp -d "$cache/.generating.XXXXXXXX")
	trap 'rm -rf "$temporary"; cleanup_playback' EXIT
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
	/usr/bin/afplay "$audio" &
	player=$!
	printf '%s\n' "$player" > "$audio.pid"
	trap 'kill -CONT "$player" 2>/dev/null || true; kill -TERM "$player" 2>/dev/null || true; exit 143' INT TERM HUP
	wait "$player"
fi
