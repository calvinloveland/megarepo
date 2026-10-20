#!/usr/bin/env bash
# Build a Red Book audio CD from a folder of ordered track files.
#
#   audio/01 - Tough.flac
#   audio/02 - Straightjacket.flac
#   ...
#
# Defaults to a dry run. Nothing touches the disc until you pass --burn.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUDIO_DIR="$ROOT/audio"
BUILD_DIR=""
DEVICE=""
MODE="dry-run"
DO_EJECT=0
NORMALIZE=0

# Red Book allows 79:57 of audio on an 80-minute disc.
CD_LIMIT_SECONDS=$((79 * 60 + 57))
TARGET_RATE=44100
TARGET_CHANNELS=2

usage() {
  cat <<'EOF'
Usage: burn-cd.sh [options]

  --audio DIR     folder of NN - Title.ext files   (default: ./audio)
  --build DIR     transcoded WAVs + cue sheet       (default: sibling of --audio)
  --device DEV    optical device                   (default: autodetect /dev/srN)
  --burn          actually write the disc          (default: dry run)
  --simulate      real drive, laser off (wodim -dummy)
  --normalize     loudness-match tracks (single-pass EBU R128, -14 LUFS)
  --eject         eject when finished
  -h, --help      this text

File names MUST start with a two-digit running-order prefix. That prefix is the
only thing that defines track order; the text after it is free-form.
EOF
}

log()  { printf '  %s\n' "$*"; }
head2() { printf '\n== %s ==\n' "$*"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

while (($#)); do
  case "$1" in
    --audio)    AUDIO_DIR="${2:?--audio needs a directory}"; shift 2 ;;
    --build)    BUILD_DIR="${2:?--build needs a directory}"; shift 2 ;;
    --device)   DEVICE="${2:?--device needs a path}"; shift 2 ;;
    --burn)     MODE="burn"; shift ;;
    --simulate) MODE="simulate"; shift ;;
    --normalize) NORMALIZE=1; shift ;;
    --eject)    DO_EJECT=1; shift ;;
    -h|--help)  usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

fmt_time() { printf '%d:%02d' $(($1 / 60)) $(($1 % 60)); }

# --- preflight -------------------------------------------------------------

head2 "preflight"
for tool in ffmpeg ffprobe; do
  command -v "$tool" >/dev/null || die "$tool not found (run inside the project shell.nix)"
done
log "ffmpeg: $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f1-3)"

[ -d "$AUDIO_DIR" ] || die "audio folder not found: $AUDIO_DIR"
log "audio: $AUDIO_DIR"

if [ -z "$DEVICE" ]; then
  for candidate in /dev/sr*; do
    [ -e "$candidate" ] && DEVICE="$candidate" && break
  done
fi

if [ -n "$DEVICE" ]; then
  [ -e "$DEVICE" ] || die "device not present: $DEVICE"
  model_file="/sys/class/block/$(basename "$DEVICE")/device/model"
  if [ -r "$model_file" ]; then
    log "device: $DEVICE  $(tr -d '\n' < "$model_file")"
  else
    log "device: $DEVICE  (model unknown)"
  fi
else
  log "device: none found — set --device once the USB burner is plugged in"
fi

if [ "$MODE" != "dry-run" ]; then
  [ -n "$DEVICE" ] || die "no optical device detected; plug in the burner or pass --device"
  command -v wodim >/dev/null || die "wodim not found (run inside the project shell.nix)"
fi

# The build dir lives beside the audio it came from, so two different discs in
# two different folders cannot clobber each other.
if [ -z "$BUILD_DIR" ]; then
  BUILD_DIR="$(dirname "$AUDIO_DIR")/build"
fi
case "$(readlink -m "$BUILD_DIR")" in
  /|/home|/nix/store|/nix) die "refusing to use $BUILD_DIR as the build dir" ;;
esac
log "build: $BUILD_DIR"

head2 "tracks"
shopt -s nullglob
mapfile -t RAW < <(
  find "$AUDIO_DIR" -maxdepth 1 -type f \
    \( -iname '*.wav' -o -iname '*.flac' -o -iname '*.mp3' -o -iname '*.m4a' \
       -o -iname '*.aac' -o -iname '*.aif' -o -iname '*.aiff' -o -iname '*.ogg' \
       -o -iname '*.opus' -o -iname '*.wma' \) -printf '%f\n' | sort
)
((${#RAW[@]})) || die "no audio files in $AUDIO_DIR (expected '01 - Title.ext', ...)"

NO_PREFIX=()
declare -a ORDERED=()
for name in "${RAW[@]}"; do
  [[ "$name" =~ ^([0-9]{2})[[:space:]_.-] ]] || { NO_PREFIX+=("$name"); continue; }
  ORDERED+=("$name")
done

if ((${#NO_PREFIX[@]})); then
  printf 'error: these files have no two-digit order prefix:\n' >&2
  printf '  %s\n' "${NO_PREFIX[@]}" >&2
  exit 1
fi

# Order by the numeric prefix (version sort keeps 02 before 10), then verify
# the numbering runs 1..N with no gaps.
mapfile -t ORDERED < <(printf '%s\n' "${ORDERED[@]}" | sort -V)

expected=1
total=0
DURATIONS=()
for name in "${ORDERED[@]}"; do
  num=$((10#${name:0:2}))
  if [ "$num" -ne "$expected" ]; then
    die "track numbering breaks at '$name' (expected prefix $(printf '%02d' "$expected"))"
  fi
  path="$AUDIO_DIR/$name"
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$path")
  [[ "$dur" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "cannot read duration of '$name'"
  secs=$((10#${dur%%.*}))   # floor; never round up toward the disc limit
  DURATIONS+=("$secs")
  total=$((total + secs))
  log "$(printf '%02d' "$num")  $(fmt_time "$secs")  $name"
  expected=$((expected + 1))
done

log "-----"
log "${#ORDERED[@]} tracks, ${total}s total = $(fmt_time "$total")"

if [ "$total" -gt "$CD_LIMIT_SECONDS" ]; then
  die "program is $(fmt_time "$total") — over the $(fmt_time "$CD_LIMIT_SECONDS") Red Book limit by $(fmt_time $((total - CD_LIMIT_SECONDS)))"
fi
log "headroom: $(fmt_time $((CD_LIMIT_SECONDS - total)))"

# --- transcode to Red Book WAV --------------------------------------------

head2 "transcode -> 44.1 kHz / 16-bit / stereo"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

idx=0
for name in "${ORDERED[@]}"; do
  idx=$((idx + 1))
  base="${name%.*}"
  out="$BUILD_DIR/$(printf '%02d' "$idx") - ${base:5}.wav"
  filters=()
  if [ "$NORMALIZE" = 1 ]; then
    filters=(-af "loudnorm=I=-14:TP=-1.5:LRA=11")
  fi
  ffmpeg -nostdin -v error -y -i "$AUDIO_DIR/$name" \
    -map 0:a:0 "${filters[@]}" \
    -ar "$TARGET_RATE" -ac "$TARGET_CHANNELS" -c:a pcm_s16le \
    "$out"
  log "built $(basename "$out")"
done

# --- verify the built WAVs are actually disc-legal ------------------------

head2 "verify"
bad=0
for wav in "$BUILD_DIR"/*.wav; do
  info=$(ffprobe -v error -select_streams a:0 \
    -show_entries stream=codec_name,sample_rate,channels \
    -of csv=p=0 "$wav")
  if [ "$info" != "pcm_s16le,$TARGET_RATE,$TARGET_CHANNELS" ]; then
    printf '  FAIL %s -> %s\n' "$(basename "$wav")" "$info" >&2
    bad=1
  fi
done
[ "$bad" = 0 ] || die "some tracks are not Red Book compliant"
log "all ${#ORDERED[@]} tracks: pcm_s16le / 44100 Hz / 2ch"

# --- cue sheet -------------------------------------------------------------

head2 "cue sheet"
CUE="$BUILD_DIR/disc.cue"
{
  echo 'REM generated by burn-cd.sh — reference sheet, not used by wodim'
  echo "PERFORMER \"Quinn XCII\""
  echo "TITLE \"Quinn XCII — Most Popular\""
  echo "FILE \"disc.bin\" BINARY"
  # wodim writes a 2-second post-gap after every track, so INDEX 01 for track n
  # (n>1) runs 2s late per preceding track.
  offset=0
  idx=0
  for name in "${ORDERED[@]}"; do
    idx=$((idx + 1))
    title="${name%.*}"; title="${title:5}"
    mm=$((offset / 60)); ss=$((offset % 60))
    printf '  TRACK %02d AUDIO\n' "$idx"
    printf '    TITLE "%s"\n' "$title"
    printf '    PERFORMER "Quinn XCII"\n'
    printf '    INDEX 01 %02d:%02d:00\n' "$mm" "$ss"
    offset=$((offset + DURATIONS[idx-1] + 2))
  done
} > "$CUE"
log "wrote build/disc.cue"

# --- burn -----------------------------------------------------------------

head2 "burn"
if [ "$MODE" = "dry-run" ]; then
  log "dry run — nothing written."
  log "re-run with --burn (or --simulate to test the real drive, laser off)."
  exit 0
fi

# shellcheck disable=SC2206
files=("$BUILD_DIR"/*.wav)
args=(-v -dao -audio -pad dev="$DEVICE")
[ "$MODE" = "simulate" ] && args+=(-dummy)

log "wodim ${args[*]} <${#files[@]} wavs>"
[ "$MODE" = "simulate" ] && log "SIMULATE: drive will spin but not write"

wodim "${args[@]}" "${files[@]}"

if [ "$DO_EJECT" = 1 ]; then
  eject "$DEVICE" || true
fi
log "done. Insert the disc in a player to confirm track order and gaps."
