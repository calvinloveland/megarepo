# Quinn XCII — CD burn kit

Build a Red Book audio CD of Quinn XCII's most popular tracks for a gift. This
folder is the whole kit: the curated running order, the sourcing notes, and a
script that turns a folder of files into a disc that plays in a car stereo.

Two things this kit deliberately does **not** do:

- It does not download music. Sourcing the audio is your job, from a licensed
  store (`docs/tracklist.md` lists the ones that carry him).
- It does not guess at popularity. The ranking comes from a pinned snapshot of
  Deezer's top-tracks chart, checked into `data/` so the order is reproducible.

## What you get

| File | Purpose |
|------|---------|
| `docs/tracklist.md` | 24 tracks, 75:46 total, with alternates |
| `scripts/build_tracklist.js` | Regenerates the tracklist from the snapshot; fails loudly if a runtime creeps past the CD limit |
| `scripts/burn-cd.sh` | Transcode → verify → cue → burn |
| `scripts/test-burn.sh` | 20 assertions against synthetic audio, no drive needed |
| `shell.nix` | `ffmpeg`, `wodim`, `readcd`, `eject` — none are installed system-wide |
| `data/deezer-top-60.json` | Pinned popularity snapshot (metadata only, no audio) |

## Why the running order looks like that

Deezer's artist "top tracks" list is ordered by popular usage, so it is a real
popularity signal rather than a guess. A few artifacts of that source:

- It mixes in tracks where Quinn XCII is only a featured artist (`Love Me Less`
  with MAX, `Little Things` with Louis The Child, `Kings of Summer` with ayokay).
  Those are some of his biggest records, so they are kept — but grouped at the
  end, so the disc plays as solo material first.
- Deezer's `rank` field disagrees with its top-tracks ordering in a few places
  (`U & Us` has a high rank but sits deep in the list). Where they disagree, the
  ordering wins; `rank` is a tiebreaker. `U & Us` is included anyway because it
  is the highest-ranked track in the whole snapshot.

24 tracks / 75:46 on an 80-minute disc leaves 4:11 of headroom, which matters
because `wodim` pads the final track and writes 2-second gaps.

## Step 1 — get the audio

Buy from Bandcamp, the iTunes Store, Amazon Music's MP3 store, or Qobuz, and
keep the files. Lossless (ALAC/FLAC) gives the cleanest disc; 256k+ AAC/MP3 is
fine, the transcode is lossless from that point on.

Drop them in `audio/`, two-digit prefix first:

```
audio/01 - Tough.flac
audio/02 - Straightjacket.flac
audio/03 - Stacy.flac
...
```

The prefix is the only thing that sets track order. Anything else in the name is
free-form. Every file must have a prefix and the numbering must run 1..N with no
gaps — the script refuses to burn a disc with a hole in the sequence rather than
silently reordering your gift.

## Step 2 — dry run

```sh
cd active/personal/quinn-xcii-cd
nix-shell --run 'scripts/burn-cd.sh'
```

It reports the drive it found, each track with its duration, the total, the
headroom, then transcodes and verifies. Nothing touches the disc without
`--burn`.

## Step 3 — burn

Plug the USB burner in, then:

```sh
nix-shell --run 'scripts/burn-cd.sh --burn --eject'
```

Useful flags:

| Flag | Effect |
|------|--------|
| `--simulate` | Spins the real drive with the laser off (`wodim -dummy`) — a free rehearsal |
| `--normalize` | Single-pass EBU R128 loudness match to −14 LUFS |
| `--device /dev/sr1` | Override autodetection |
| `--build DIR` | Put the transcoded WAVs somewhere other than `<audio>/../build` |

`--normalize` is off by default on purpose: these tracks come from six different
albums with different mastering, so if the disc sounds jumpy between tracks,
that flag is the fix. It changes the audio permanently for that burn, so try one
disc without it first.

## How the burn works

- Everything is transcoded to `pcm_s16le` / 44100 Hz / stereo, then re-probed.
  A track that fails the check aborts the burn instead of producing a disc that
  some players reject.
- `wodim -dao -audio -pad` writes disc-at-once, which is what avoids the clicks
  and 2-second hiccups that track-at-once burns get between tracks.
- `build/disc.cue` is a reference sheet modelling the 2-second inter-track gaps
  `wodim` inserts. `wodim` burns the WAVs directly, so the cue is for archival
  and for GUI tools, not a burn input.

## Testing

```sh
nix-shell --run 'bash scripts/test-burn.sh'
```

Synthetic tones only, no disc and no drive. Covers: prefix ordering beats file
mtimes, transcode produces legal Red Book WAVs, cue offsets account for gaps,
and the rejections (numbering gap, missing prefix, empty folder, missing folder,
over-length program, `--burn` with no drive). Current state: **20 assertions,
all passing**.

## Host note

This machine has no optical drive at all — no `/dev/sr*`, and `lsblk` shows only
`sda`/`sdb`. The USB burner provides the device node when plugged in, and
`shell.nix` provides the software, so no root install is needed.
