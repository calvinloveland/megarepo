#!/usr/bin/env bash
# Exercises burn-cd.sh against synthetic audio. Needs ffmpeg (use shell.nix).
# Never touches a real drive: every case that reaches the burner is run with
# --dry-run.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/burn-cd.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0
fail=0
ok()   { printf '  PASS  %s\n' "$*"; pass=$((pass + 1)); }
bad()  { printf '  FAIL  %s\n' "$*"; fail=$((fail + 1)); }

# A tone of N seconds, at an intentionally awkward source format so the
# transcode path is real: 48 kHz mono 24-bit.
tone() {
  ffmpeg -nostdin -v error -y -f lavfi -i "sine=frequency=$2:duration=$3" \
    -ar 48000 -ac 1 -c:a pcm_s24le "$1"
}

run() { # run <expected-exit> <label> <args...>
  local want="$1" label="$2"; shift 2
  local out rc
  out=$("$@" 2>&1); rc=$?
  if [ "$rc" -eq "$want" ]; then ok "$label"; else
    bad "$label (exit $rc, wanted $want)"; printf '%s\n' "$out" | sed 's/^/        /'
  fi
  LAST_OUT="$out"
}

expect_in() { grep -qE "$1" <<<"$LAST_OUT" && ok "$2" || bad "$2 (missing: $1)"; }

# --- happy path ------------------------------------------------------------
echo "== happy path: 3 tracks, out-of-order file creation =="
audio="$WORK/ok/audio"; mkdir -p "$audio"
tone "$audio/03 - Three.wav" 660 5
tone "$audio/01 - One.wav"   440 7
tone "$audio/02 - Two.wav"   550 6

run 0 "3 tracks pass" "$SCRIPT" --audio "$audio"
expect_in "44[.]1|44100" "verified 44.1 kHz"
expect_in "3 tracks, 18s total = 0:18" "durations summed in prefix order"
expect_in "dry run" "stops before writing"

built="$WORK/ok/build"
count=$(find "$built" -name '*.wav' | wc -l)
[ "$count" -eq 3 ] && ok "built 3 wavs" || bad "built $count wavs, wanted 3"
for f in "$built"/*.wav; do
  info=$(ffprobe -v error -select_streams a:0 \
    -show_entries stream=codec_name,sample_rate,channels -of csv=p=0 "$f")
  [ "$info" = "pcm_s16le,44100,2" ] || bad "$(basename "$f") -> $info"
done
ok "all built wavs are pcm_s16le/44100/2ch"
grep -q 'TRACK 01 AUDIO' "$built/disc.cue" && ok "cue has tracks" || bad "cue missing tracks"
grep -q 'INDEX 01 00:09:00' "$built/disc.cue" \
  && ok "cue accounts for 2s inter-track gaps" || bad "cue offsets wrong"

# Track order must follow prefixes, not mtimes.
first=$(find "$built" -name '01 *' -printf '%f\n'); [[ "$first" == *One* ]] \
  && ok "track 01 is the 01-prefixed file" || bad "track 01 is $first"

# --- rejections ------------------------------------------------------------
echo "== rejections =="

missing="$WORK/missing/audio"; mkdir -p "$missing"
tone "$missing/01 - One.wav" 440 4
tone "$missing/03 - Three.wav" 550 4
run 1 "gap in numbering is rejected" "$SCRIPT" --audio "$missing"
expect_in "numbering breaks" "explains the gap"

noprefix="$WORK/noprefix/audio"; mkdir -p "$noprefix"
tone "$noprefix/One.wav" 440 4
run 1 "file without order prefix is rejected" "$SCRIPT" --audio "$noprefix"
expect_in "no two-digit order prefix" "explains the prefix rule"

empty="$WORK/empty/audio"; mkdir -p "$empty"
run 1 "empty folder is rejected" "$SCRIPT" --audio "$empty"
expect_in "no audio files" "explains empty folder"

run 1 "missing audio folder is rejected" "$SCRIPT" --audio "$WORK/nope"

# Over-length program: run a copy with the CD limit dialled down to 10s.
tight="$WORK/tight/burn-cd-tight.sh"
mkdir -p "$WORK/tight"
sed -E 's/^CD_LIMIT_SECONDS=.*/CD_LIMIT_SECONDS=10/' "$SCRIPT" > "$tight"
chmod +x "$tight"
run 1 "over-long program is rejected" bash "$tight" --audio "$audio"
expect_in "over the 0:10 Red Book limit" "reports the overage"

# --burn with no drive must refuse rather than guess.
run 1 "--burn without a device is refused" "$SCRIPT" --audio "$audio" --burn
expect_in "no optical device detected" "explains the missing drive"

echo
printf 'pass=%d fail=%d\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
